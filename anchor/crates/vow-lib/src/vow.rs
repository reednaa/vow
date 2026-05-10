use anchor_lang::prelude::*;
use solana_program::secp256k1_recover::secp256k1_recover;

use crate::crypto::{bare_eip712_domain_typehash, keccak256, keccak256_chain, vow_type_hash_bytes};
use crate::directory::ensure_quorum;
use crate::errors::VowError;

pub const EVENT_ENCODED_HEADER_SIZE: usize = 21;
pub const EMIT_CPI_HEADER_SIZE: usize = 40;
pub const ETHEREUM_COMPACT_SIGNATURE_LEN: usize = 64;
pub const ETHEREUM_RECOVERABLE_SIGNATURE_LEN: usize = 65;
pub const VOW_HEADER_LEN: usize = 68;

#[derive(Debug, Clone, PartialEq, Eq, AnchorSerialize, AnchorDeserialize)]
pub struct ProcessedVow {
    pub chain_id: [u8; 32],
    pub root_block_number: [u8; 32],
    pub event_bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, AnchorSerialize, AnchorDeserialize)]
pub struct DecodedEvent {
    pub emitter: [u8; 20],
    pub topics: Vec<[u8; 32]>,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, AnchorSerialize, AnchorDeserialize)]
pub struct DecodedEmitCpi {
    pub program_id: [u8; 32],
    pub discriminator: [u8; 8],
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VowHeader {
    pub chain_id: [u8; 32],
    pub root_block_number: [u8; 32],
    pub proof_size: usize,
    pub num_signers: usize,
    pub evt_len: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedSignature {
    pub signature: [u8; 64],
    pub recovery_id: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedVow<'a> {
    pub header: VowHeader,
    pub proof: Vec<[u8; 32]>,
    pub evt_bytes: &'a [u8],
    pub signer_indices: Vec<u8>,
    pub signatures: Vec<NormalizedSignature>,
}

pub fn parse_vow_header(vow_data: &[u8]) -> Result<VowHeader> {
    require!(vow_data.len() >= VOW_HEADER_LEN, VowError::VowTooShort);

    let mut chain_id = [0u8; 32];
    chain_id.copy_from_slice(&vow_data[0..32]);

    let mut root_block_number = [0u8; 32];
    root_block_number.copy_from_slice(&vow_data[32..64]);

    Ok(VowHeader {
        chain_id,
        root_block_number,
        proof_size: vow_data[64] as usize,
        num_signers: vow_data[65] as usize,
        evt_len: ((vow_data[66] as usize) << 8) | vow_data[67] as usize,
    })
}

pub fn parse_vow(vow_data: &[u8]) -> Result<ParsedVow<'_>> {
    let header = parse_vow_header(vow_data)?;
    let proof_bytes_end = VOW_HEADER_LEN + header.proof_size * 32;
    let signer_indices_end = proof_bytes_end + header.num_signers;
    require!(vow_data.len() >= signer_indices_end, VowError::VowTooShort);

    let evt_start = vow_data
        .len()
        .checked_sub(header.evt_len)
        .ok_or(error!(VowError::VowTooShort))?;
    require!(evt_start >= signer_indices_end, VowError::VowTooShort);

    let mut proof = Vec::with_capacity(header.proof_size);
    for i in 0..header.proof_size {
        let start = VOW_HEADER_LEN + i * 32;
        let mut node = [0u8; 32];
        node.copy_from_slice(&vow_data[start..start + 32]);
        proof.push(node);
    }

    let signer_indices: Vec<u8> = vow_data[proof_bytes_end..signer_indices_end]
        .iter()
        .copied()
        .take_while(|&index| index != 0)
        .collect();

    let mut signatures = Vec::with_capacity(signer_indices.len());
    let mut sig_cursor = signer_indices_end;
    for _ in 0..signer_indices.len() {
        require!(sig_cursor + 2 <= evt_start, VowError::VowTooShort);
        let sig_len = ((vow_data[sig_cursor] as usize) << 8) | vow_data[sig_cursor + 1] as usize;
        sig_cursor += 2;
        require!(sig_cursor + sig_len <= evt_start, VowError::VowTooShort);

        signatures.push(normalize_signature(
            &vow_data[sig_cursor..sig_cursor + sig_len],
        )?);
        sig_cursor += sig_len;
    }

    Ok(ParsedVow {
        header,
        proof,
        evt_bytes: &vow_data[evt_start..],
        signer_indices,
        signatures,
    })
}

pub fn normalize_signature(signature: &[u8]) -> Result<NormalizedSignature> {
    match signature.len() {
        ETHEREUM_COMPACT_SIGNATURE_LEN => {
            let mut compact = [0u8; ETHEREUM_COMPACT_SIGNATURE_LEN];
            compact.copy_from_slice(signature);
            let recovery_id = compact[32] >> 7;
            compact[32] &= 0x7f;
            Ok(NormalizedSignature {
                signature: compact,
                recovery_id,
            })
        }
        ETHEREUM_RECOVERABLE_SIGNATURE_LEN => {
            let mut recoverable = [0u8; ETHEREUM_COMPACT_SIGNATURE_LEN];
            recoverable.copy_from_slice(&signature[..ETHEREUM_COMPACT_SIGNATURE_LEN]);
            let v = signature[ETHEREUM_COMPACT_SIGNATURE_LEN];
            let recovery_id = if v >= 27 { v - 27 } else { v };
            require!(recovery_id <= 1, VowError::InvalidSecp256k1Signature);
            Ok(NormalizedSignature {
                signature: recoverable,
                recovery_id,
            })
        }
        _ => Err(error!(VowError::InvalidSecp256k1Signature)),
    }
}

pub fn process_vow(
    vow_data: &[u8],
    quorum: u8,
    stored_signers: &[[u8; 20]],
) -> Result<ProcessedVow> {
    let parsed = parse_vow(vow_data)?;

    ensure_quorum(quorum, parsed.signer_indices.len())?;
    require!(
        stored_signers.len() == parsed.signer_indices.len(),
        VowError::ZeroSigner,
    );

    for signer in stored_signers {
        require!(*signer != [0u8; 20], VowError::ZeroSigner);
    }

    let leaf = leaf_hash(parsed.evt_bytes);
    let root = compute_merkle_root(&parsed.proof, &leaf);
    verify_signed_vow(
        &parsed.header.chain_id,
        &parsed.header.root_block_number,
        &root,
        stored_signers,
        &parsed.signatures,
    )?;

    Ok(ProcessedVow {
        chain_id: parsed.header.chain_id,
        root_block_number: parsed.header.root_block_number,
        event_bytes: parsed.evt_bytes.to_vec(),
    })
}

pub fn hash_typed_data(struct_hash: &[u8; 32]) -> [u8; 32] {
    let domain_separator = bare_eip712_domain_typehash();
    let mut packed = [0u8; 66];
    packed[0] = 0x19;
    packed[1] = 0x01;
    packed[2..34].copy_from_slice(&domain_separator);
    packed[34..66].copy_from_slice(struct_hash);
    keccak256(&packed)
}

pub fn vow_typehash(
    chain_id: &[u8; 32],
    root_block_number: &[u8; 32],
    root: &[u8; 32],
) -> [u8; 32] {
    let type_hash = vow_type_hash_bytes();
    keccak256_chain(&[&type_hash, chain_id, root_block_number, root])
}

pub fn decode_event(raw: &[u8]) -> Result<DecodedEvent> {
    require!(
        raw.len() >= EVENT_ENCODED_HEADER_SIZE,
        VowError::TooManyTopics
    );

    let mut emitter = [0u8; 20];
    emitter.copy_from_slice(&raw[..20]);

    let num_topics = raw[20] as usize;
    require!(num_topics <= 4, VowError::TooManyTopics);

    let topics_end = EVENT_ENCODED_HEADER_SIZE + num_topics * 32;
    require!(raw.len() >= topics_end, VowError::TooManyTopics);

    let mut topics = Vec::with_capacity(num_topics);
    for i in 0..num_topics {
        let start = EVENT_ENCODED_HEADER_SIZE + i * 32;
        let mut topic = [0u8; 32];
        topic.copy_from_slice(&raw[start..start + 32]);
        topics.push(topic);
    }

    Ok(DecodedEvent {
        emitter,
        topics,
        data: raw[topics_end..].to_vec(),
    })
}

pub fn decode_emit_cpi(raw: &[u8]) -> Result<DecodedEmitCpi> {
    require!(raw.len() >= EMIT_CPI_HEADER_SIZE, VowError::InvalidEmitCpi);

    let mut program_id = [0u8; 32];
    program_id.copy_from_slice(&raw[..32]);

    let mut discriminator = [0u8; 8];
    discriminator.copy_from_slice(&raw[32..40]);

    Ok(DecodedEmitCpi {
        program_id,
        discriminator,
        data: raw[40..].to_vec(),
    })
}

pub fn encode_event(emitter: &[u8; 20], topics: &[[u8; 32]], data: &[u8]) -> Result<Vec<u8>> {
    require!(topics.len() <= 4, VowError::TooManyTopics);

    let mut encoded =
        Vec::with_capacity(EVENT_ENCODED_HEADER_SIZE + topics.len() * 32 + data.len());
    encoded.extend_from_slice(emitter);
    encoded.push(topics.len() as u8);
    for topic in topics {
        encoded.extend_from_slice(topic);
    }
    encoded.extend_from_slice(data);
    Ok(encoded)
}

pub fn leaf_hash(evt: &[u8]) -> [u8; 32] {
    keccak256(&keccak256(evt))
}

pub fn compute_merkle_root(proof: &[[u8; 32]], leaf: &[u8; 32]) -> [u8; 32] {
    let mut root = *leaf;
    for sibling in proof {
        let (left, right) = if root <= *sibling {
            (&root, sibling)
        } else {
            (sibling, &root)
        };
        root = keccak256_chain(&[left, right]);
    }
    root
}

pub fn recover_eth_address(digest: &[u8; 32], signature: &NormalizedSignature) -> Result<[u8; 20]> {
    let pubkey_64 = secp256k1_recover(digest, signature.recovery_id, &signature.signature)
        .map_err(|_| error!(VowError::InvalidSecp256k1Signature))?;

    let hash = keccak256(&pubkey_64.to_bytes());
    let mut eth_address = [0u8; 20];
    eth_address.copy_from_slice(&hash[12..32]);
    Ok(eth_address)
}

pub fn verify_signed_vow(
    chain_id: &[u8; 32],
    root_block_number: &[u8; 32],
    root: &[u8; 32],
    signers: &[[u8; 20]],
    signatures: &[NormalizedSignature],
) -> Result<()> {
    require!(
        signers.len() == signatures.len(),
        VowError::InvalidlySignedRoot,
    );

    let digest = hash_typed_data(&vow_typehash(chain_id, root_block_number, root));
    for (signer, signature) in signers.iter().zip(signatures.iter()) {
        let recovered = recover_eth_address(&digest, signature)?;
        require!(&recovered == signer, VowError::InvalidlySignedRoot);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bytes32(value: u8) -> [u8; 32] {
        let mut bytes = [0u8; 32];
        bytes[31] = value;
        bytes
    }

    fn encode_vow_for_test(
        chain_id: [u8; 32],
        root_block_number: [u8; 32],
        proof: &[[u8; 32]],
        signer_indices: &[u8],
        signatures: &[&[u8]],
        evt: &[u8],
    ) -> Vec<u8> {
        let signature_section_len: usize =
            signatures.iter().map(|signature| 2 + signature.len()).sum();
        let mut encoded = Vec::with_capacity(
            VOW_HEADER_LEN
                + proof.len() * 32
                + signer_indices.len()
                + signature_section_len
                + evt.len(),
        );
        encoded.extend_from_slice(&chain_id);
        encoded.extend_from_slice(&root_block_number);
        encoded.push(proof.len() as u8);
        encoded.push(signer_indices.len() as u8);
        encoded.push(((evt.len() >> 8) & 0xff) as u8);
        encoded.push((evt.len() & 0xff) as u8);
        for node in proof {
            encoded.extend_from_slice(node);
        }
        encoded.extend_from_slice(signer_indices);
        for signature in signatures {
            encoded.push(((signature.len() >> 8) & 0xff) as u8);
            encoded.push((signature.len() & 0xff) as u8);
            encoded.extend_from_slice(signature);
        }
        encoded.extend_from_slice(evt);
        encoded
    }

    #[test]
    fn normalizes_compact_signatures() {
        let mut compact = [0u8; ETHEREUM_COMPACT_SIGNATURE_LEN];
        compact[0] = 0x11;
        compact[32] = 0x80;
        compact[63] = 0x22;

        let normalized = normalize_signature(&compact).unwrap();
        assert_eq!(normalized.recovery_id, 1);
        assert_eq!(normalized.signature[0], 0x11);
        assert_eq!(normalized.signature[32], 0x00);
        assert_eq!(normalized.signature[63], 0x22);
    }

    #[test]
    fn normalizes_recoverable_signatures() {
        let mut recoverable = [0u8; ETHEREUM_RECOVERABLE_SIGNATURE_LEN];
        recoverable[0] = 0xaa;
        recoverable[64] = 28;

        let normalized = normalize_signature(&recoverable).unwrap();
        assert_eq!(normalized.recovery_id, 1);
        assert_eq!(normalized.signature[0], 0xaa);
    }

    #[test]
    fn parses_vow_with_compact_signature() {
        let event = encode_event(&[0x11; 20], &[bytes32(1), bytes32(2)], &[0xaa, 0xbb]).unwrap();
        let compact_signature = [0x44; ETHEREUM_COMPACT_SIGNATURE_LEN];
        let vow = encode_vow_for_test(
            bytes32(10),
            bytes32(20),
            &[bytes32(3)],
            &[1],
            &[&compact_signature],
            &event,
        );

        let parsed = parse_vow(&vow).unwrap();
        assert_eq!(parsed.header.proof_size, 1);
        assert_eq!(parsed.header.num_signers, 1);
        assert_eq!(parsed.signer_indices, vec![1]);
        assert_eq!(parsed.proof, vec![bytes32(3)]);
        assert_eq!(parsed.evt_bytes, event.as_slice());
        assert_eq!(parsed.signatures.len(), 1);
        assert_eq!(parsed.signatures[0].recovery_id, 0);
    }

    #[test]
    fn decodes_events_and_emit_cpi_payloads() {
        let event = encode_event(&[0x22; 20], &[bytes32(7)], &[0xde, 0xad]).unwrap();
        let decoded_event = decode_event(&event).unwrap();
        assert_eq!(decoded_event.emitter, [0x22; 20]);
        assert_eq!(decoded_event.topics, vec![bytes32(7)]);
        assert_eq!(decoded_event.data, vec![0xde, 0xad]);

        let mut emit_cpi = Vec::new();
        emit_cpi.extend_from_slice(&bytes32(9));
        emit_cpi.extend_from_slice(&[1, 2, 3, 4, 5, 6, 7, 8]);
        emit_cpi.extend_from_slice(&[0xfa, 0xce]);

        let decoded_emit_cpi = decode_emit_cpi(&emit_cpi).unwrap();
        assert_eq!(decoded_emit_cpi.program_id, bytes32(9));
        assert_eq!(decoded_emit_cpi.discriminator, [1, 2, 3, 4, 5, 6, 7, 8]);
        assert_eq!(decoded_emit_cpi.data, vec![0xfa, 0xce]);
    }

    #[test]
    fn reconstructs_sorted_merkle_roots() {
        let leaf = bytes32(5);
        let sibling = bytes32(2);
        let manual = keccak256_chain(&[&sibling, &leaf]);
        assert_eq!(compute_merkle_root(&[sibling], &leaf), manual);
    }
}
