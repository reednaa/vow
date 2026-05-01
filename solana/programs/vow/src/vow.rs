use crate::crypto::{
    bare_eip712_domain_typehash, keccak256, keccak256_chain,
    vow_type_hash_bytes,
};
use crate::errors::VowError;
use anchor_lang::prelude::*;
use solana_program::secp256k1_recover::secp256k1_recover;

pub const EVENT_ENCODED_HEADER_SIZE: usize = 21;
pub const ETHEREUM_SIGNATURE_LEN: usize = 65;
pub const VOW_HEADER_LEN: usize = 68;

#[derive(Debug, Clone)]
pub struct DecodedEvent {
    pub emitter: [u8; 20],
    pub topics: Vec<[u8; 32]>,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct VowHeader {
    pub chain_id: [u8; 32],
    pub root_block_number: [u8; 32],
    pub proof_size: usize,
    pub num_signers: usize,
    pub evt_len: usize,
}

#[derive(Debug, Clone)]
pub struct ParsedVow<'a> {
    pub header: VowHeader,
    pub proof: Vec<[u8; 32]>,
    pub evt_bytes: &'a [u8],
    pub signer_indices: Vec<u8>,
    pub signatures: Vec<[u8; 65]>,
}

// ── Vow parsing ──

pub fn parse_vow_header(vow_data: &[u8]) -> Result<VowHeader> {
    require!(vow_data.len() >= VOW_HEADER_LEN, VowError::VowTooShort);

    let mut chain_id = [0u8; 32];
    chain_id.copy_from_slice(&vow_data[0..32]);

    let mut root_block_number = [0u8; 32];
    root_block_number.copy_from_slice(&vow_data[32..64]);

    let proof_size = vow_data[64] as usize;
    let num_signers = vow_data[65] as usize;
    let evt_len =
        ((vow_data[66] as usize) << 8) | (vow_data[67] as usize);

    Ok(VowHeader { chain_id, root_block_number, proof_size, num_signers, evt_len })
}

pub fn parse_vow(vow_data: &[u8]) -> Result<ParsedVow<'_>> {
    let header = parse_vow_header(vow_data)?;

    let header_end: usize = VOW_HEADER_LEN;
    let proof_bytes_end = header_end + header.proof_size * 32;
    let signer_indices_end = proof_bytes_end + header.num_signers;
    require!(vow_data.len() >= signer_indices_end, VowError::VowTooShort);

    let mut proof: Vec<[u8; 32]> = Vec::with_capacity(header.proof_size);
    for i in 0..header.proof_size {
        let start = header_end + i * 32;
        let mut node = [0u8; 32];
        node.copy_from_slice(&vow_data[start..start + 32]);
        proof.push(node);
    }

    let signer_indices: Vec<u8> =
        vow_data[proof_bytes_end..signer_indices_end]
            .iter()
            .copied()
            .take_while(|&b| b != 0)
            .collect();

    require!(vow_data.len() >= header.evt_len, VowError::VowTooShort);
    let evt_start = vow_data.len() - header.evt_len;
    let evt_bytes = &vow_data[evt_start..];

    let num_active = signer_indices.len();
    let mut sig_cursor: usize = signer_indices_end;
    let mut signatures: Vec<[u8; 65]> = Vec::with_capacity(num_active);

    for _i in 0..num_active {
        require!(sig_cursor + 2 <= evt_start, VowError::VowTooShort);
        let sig_len = ((vow_data[sig_cursor] as usize) << 8)
            | (vow_data[sig_cursor + 1] as usize);
        sig_cursor += 2;

        require!(sig_len == ETHEREUM_SIGNATURE_LEN, VowError::InvalidSecp256k1Signature);
        require!(sig_cursor + sig_len <= evt_start, VowError::VowTooShort);

        let mut sig = [0u8; 65];
        sig.copy_from_slice(
            &vow_data[sig_cursor..sig_cursor + ETHEREUM_SIGNATURE_LEN],
        );
        signatures.push(sig);
        sig_cursor += sig_len;
    }

    Ok(ParsedVow { header, proof, evt_bytes, signer_indices, signatures })
}

// ── Core processing (library entry point) ──

pub fn process_vow_bare(
    vow_data: &[u8],
    quorum: u8,
    stored_signers: &[[u8; 20]],
) -> Result<DecodedEvent> {
    let parsed = parse_vow(vow_data)?;

    require!(
        parsed.signer_indices.len() >= quorum as usize,
        VowError::NoQuorum(quorum, parsed.signer_indices.len() as u8),
    );
    require!(
        stored_signers.len() == parsed.signer_indices.len(),
        VowError::ZeroSigner,
    );
    for addr in stored_signers {
        require!(*addr != [0u8; 20], VowError::ZeroSigner);
    }

    let leaf = leaf_hash(parsed.evt_bytes);
    let root = compute_merkle_root(&parsed.proof, &leaf);

    let struct_hash = vow_typehash(
        &parsed.header.chain_id,
        &parsed.header.root_block_number,
        &root,
    );
    let digest = hash_typed_data(&struct_hash);

    for i in 0..parsed.signer_indices.len() {
        let recovered = recover_eth_address(&digest, &parsed.signatures[i])?;
        require!(recovered == stored_signers[i], VowError::InvalidSecp256k1Signature);
    }

    let event = decode_event(parsed.evt_bytes)?;
    require!(event.topics.len() <= 4, VowError::TooManyTopics);

    Ok(event)
}

// ── Primitive operations (all pub — composable by downstream programs) ──

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
    require!(raw.len() >= EVENT_ENCODED_HEADER_SIZE, VowError::TooManyTopics);

    let mut emitter = [0u8; 20];
    emitter.copy_from_slice(&raw[0..20]);

    let num_topics = raw[20] as usize;
    require!(num_topics <= 4, VowError::TooManyTopics);

    let topics_offset: usize = 21;
    let topics_end = topics_offset + num_topics * 32;
    require!(raw.len() >= topics_end, VowError::TooManyTopics);

    let mut topics: Vec<[u8; 32]> = Vec::with_capacity(num_topics);
    for i in 0..num_topics {
        let start = topics_offset + i * 32;
        let mut topic = [0u8; 32];
        topic.copy_from_slice(&raw[start..start + 32]);
        topics.push(topic);
    }

    Ok(DecodedEvent { emitter, topics, data: raw[topics_end..].to_vec() })
}

pub fn encode_event(
    emitter: &[u8; 20],
    topics: &[[u8; 32]],
    data: &[u8],
) -> Result<Vec<u8>> {
    require!(topics.len() <= 4, VowError::TooManyTopics);

    let total_len = 21 + topics.len() * 32 + data.len();
    let mut encoded = Vec::with_capacity(total_len);
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

pub fn recover_eth_address(
    digest: &[u8; 32],
    signature_65: &[u8; 65],
) -> Result<[u8; 20]> {
    let mut r = [0u8; 32];
    r.copy_from_slice(&signature_65[0..32]);

    let mut s = [0u8; 32];
    s.copy_from_slice(&signature_65[32..64]);

    let v = signature_65[64];
    let recovery_id = v.saturating_sub(27);

    let mut sig_64 = [0u8; 64];
    sig_64[0..32].copy_from_slice(&r);
    sig_64[32..64].copy_from_slice(&s);

    let pubkey_64 = secp256k1_recover(digest, recovery_id, &sig_64)
        .map_err(|_| error!(VowError::InvalidSecp256k1Signature))?;

    let hash = keccak256(&pubkey_64);
    let mut eth_address = [0u8; 20];
    eth_address.copy_from_slice(&hash[12..32]);
    Ok(eth_address)
}

pub fn verify_signed_vow(
    chain_id: &[u8; 32],
    root_block_number: &[u8; 32],
    root: &[u8; 32],
    signers: &[[u8; 20]],
    signatures: &[[u8; 65]],
) -> Result<()> {
    let struct_hash = vow_typehash(chain_id, root_block_number, root);
    let digest = hash_typed_data(&struct_hash);

    require!(signers.len() == signatures.len(), VowError::InvalidlySignedRoot);

    for i in 0..signers.len() {
        let recovered = recover_eth_address(&digest, &signatures[i])?;
        require!(recovered == signers[i], VowError::InvalidSecp256k1Signature);
    }
    Ok(())
}