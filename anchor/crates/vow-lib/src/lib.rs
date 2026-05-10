use solana_program::{keccak, secp256k1_recover::secp256k1_recover};

pub type EvmAddress = [u8; 20];

pub const VOW_STRUCT_TYPE_HASH: [u8; 32] = [
    0x69, 0x94, 0x70, 0xf4, 0x62, 0x43, 0xf3, 0xdf, 0x34, 0x42, 0x7c, 0x78, 0xdf, 0x03, 0x7c, 0x0f,
    0x63, 0xd3, 0x7d, 0x25, 0x80, 0x56, 0x2f, 0x21, 0x48, 0x90, 0xed, 0xa0, 0x07, 0x37, 0xd5, 0x29,
];

pub const BARE_EIP712_DOMAIN_TYPEHASH: [u8; 32] = [
    0x20, 0xbc, 0xc3, 0xf8, 0x10, 0x5e, 0xea, 0x47, 0xd0, 0x67, 0x38, 0x6e, 0x42, 0xe6, 0x02, 0x46,
    0xe8, 0x93, 0x93, 0xcd, 0x61, 0xc5, 0x12, 0xed, 0xd1, 0xe8, 0x76, 0x88, 0x89, 0x0f, 0xb9, 0x14,
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VowError {
    InvalidVow,
    InvalidlySignedRoot,
    TooManyTopics,
    InvalidEmitCpi,
    InvalidEvent,
    InvalidSignature,
    SignerIndexRepeat,
    ZeroSigner,
    NoQuorum { required: usize, signers: usize },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessVowResult<'a> {
    pub chain_id: [u8; 32],
    pub root_block_number: [u8; 32],
    pub event: &'a [u8],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedEvent<'a> {
    pub emitter: EvmAddress,
    pub topics: Vec<[u8; 32]>,
    pub data: &'a [u8],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedEmitCpi<'a> {
    pub program_id: [u8; 32],
    pub discriminator: [u8; 8],
    pub data: &'a [u8],
}

pub trait WitnessDirectory {
    fn get_quorum_set(&self, signer_indices: &[u8]) -> Result<Vec<EvmAddress>, VowError>;
}

pub fn process_vow<'a, D: WitnessDirectory>(
    directory: &D,
    vow: &'a [u8],
) -> Result<ProcessVowResult<'a>, VowError> {
    if vow.len() < 68 {
        return Err(VowError::InvalidVow);
    }

    let proof_len = usize::from(vow[64]);
    let signer_index_len = usize::from(vow[65]);
    let event_len = usize::from(u16::from_be_bytes([vow[66], vow[67]]));
    let proof_bytes_len = proof_len.checked_mul(32).ok_or(VowError::InvalidVow)?;
    let proof_start = 68usize;
    let signer_indices_start = proof_start
        .checked_add(proof_bytes_len)
        .ok_or(VowError::InvalidVow)?;
    let signature_start = signer_indices_start
        .checked_add(signer_index_len)
        .ok_or(VowError::InvalidVow)?;
    let event_start = vow
        .len()
        .checked_sub(event_len)
        .ok_or(VowError::InvalidVow)?;
    if signature_start > event_start {
        return Err(VowError::InvalidVow);
    }

    let chain_id = read_array::<32>(&vow[0..32])?;
    let root_block_number = read_array::<32>(&vow[32..64])?;
    let event = &vow[event_start..];
    let leaf = leaf_hash(event);
    let proof = vow[proof_start..signer_indices_start]
        .chunks_exact(32)
        .map(read_array::<32>)
        .collect::<Result<Vec<_>, _>>()?;
    let root = compute_merkle_root(&proof, leaf);

    let signers = directory.get_quorum_set(&vow[signer_indices_start..signature_start])?;
    let mut signatures = Vec::with_capacity(signers.len());
    let mut cursor = signature_start;
    for _ in 0..signers.len() {
        let length_end = cursor.checked_add(2).ok_or(VowError::InvalidVow)?;
        if length_end > event_start {
            return Err(VowError::InvalidVow);
        }
        let signature_len = usize::from(u16::from_be_bytes([vow[cursor], vow[cursor + 1]]));
        cursor = length_end;

        let signature_end = cursor
            .checked_add(signature_len)
            .ok_or(VowError::InvalidVow)?;
        if signature_end > event_start {
            return Err(VowError::InvalidVow);
        }
        signatures.push(&vow[cursor..signature_end]);
        cursor = signature_end;
    }

    verify_signed_vow(chain_id, root_block_number, root, &signers, &signatures)?;

    Ok(ProcessVowResult {
        chain_id,
        root_block_number,
        event,
    })
}

pub fn decode_event(event: &[u8]) -> Result<DecodedEvent<'_>, VowError> {
    if event.len() < 21 {
        return Err(VowError::InvalidEvent);
    }

    let topic_count = usize::from(event[20]);
    if topic_count > 4 {
        return Err(VowError::TooManyTopics);
    }

    let topics_end = 21usize
        .checked_add(topic_count.checked_mul(32).ok_or(VowError::InvalidEvent)?)
        .ok_or(VowError::InvalidEvent)?;
    if event.len() < topics_end {
        return Err(VowError::InvalidEvent);
    }

    let topics = event[21..topics_end]
        .chunks_exact(32)
        .map(read_array::<32>)
        .collect::<Result<Vec<_>, _>>()?;

    Ok(DecodedEvent {
        emitter: read_array::<20>(&event[..20])?,
        topics,
        data: &event[topics_end..],
    })
}

pub fn decode_emit_cpi(event: &[u8]) -> Result<DecodedEmitCpi<'_>, VowError> {
    if event.len() < 40 {
        return Err(VowError::InvalidEmitCpi);
    }

    Ok(DecodedEmitCpi {
        program_id: read_array::<32>(&event[..32])?,
        discriminator: read_array::<8>(&event[32..40])?,
        data: &event[40..],
    })
}

pub fn leaf_hash(event: &[u8]) -> [u8; 32] {
    let inner = keccak_hash(event);
    keccak_hash(&inner)
}

pub fn compute_merkle_root(proof: &[[u8; 32]], leaf: [u8; 32]) -> [u8; 32] {
    let mut root = leaf;
    for node in proof {
        root = if root > *node {
            keccak_hashv(&[node, &root])
        } else {
            keccak_hashv(&[&root, node])
        };
    }
    root
}

pub fn vow_typehash(chain_id: [u8; 32], root_block_number: [u8; 32], root: [u8; 32]) -> [u8; 32] {
    keccak_hashv(&[&VOW_STRUCT_TYPE_HASH, &chain_id, &root_block_number, &root])
}

pub fn bare_eip712_domain_separator() -> [u8; 32] {
    keccak_hash(&BARE_EIP712_DOMAIN_TYPEHASH)
}

pub fn hash_typed_data(struct_hash: [u8; 32]) -> [u8; 32] {
    let domain_separator = bare_eip712_domain_separator();
    keccak_hashv(&[b"\x19\x01", &domain_separator, &struct_hash])
}

pub fn verify_signed_vow(
    chain_id: [u8; 32],
    root_block_number: [u8; 32],
    root: [u8; 32],
    signers: &[EvmAddress],
    signatures: &[&[u8]],
) -> Result<(), VowError> {
    if signers.len() != signatures.len() {
        return Err(VowError::InvalidSignature);
    }

    let digest = hash_typed_data(vow_typehash(chain_id, root_block_number, root));
    let valid = signers
        .iter()
        .zip(signatures.iter())
        .all(|(signer, signature)| verify_evm_signature(*signer, digest, signature));
    if valid {
        Ok(())
    } else {
        Err(VowError::InvalidlySignedRoot)
    }
}

pub fn verify_evm_signature(signer: EvmAddress, digest: [u8; 32], signature: &[u8]) -> bool {
    if signer == [0; 20] {
        return false;
    }

    let (recovery_id, signature_bytes) = match recoverable_signature(signature) {
        Ok(parts) => parts,
        Err(_) => return false,
    };
    let recovered = match secp256k1_recover(&digest, recovery_id, &signature_bytes) {
        Ok(pubkey) => pubkey.to_bytes(),
        Err(_) => return false,
    };
    let hash = keccak_hash(&recovered);

    hash[12..].eq(&signer)
}

fn recoverable_signature(signature: &[u8]) -> Result<(u8, [u8; 64]), VowError> {
    let mut out = [0u8; 64];
    match signature.len() {
        64 => {
            out.copy_from_slice(signature);
            let recovery_id = out[32] >> 7;
            out[32] &= 0x7f;
            Ok((recovery_id, out))
        }
        65 => {
            let v = signature[64];
            if !(27..=28).contains(&v) {
                return Err(VowError::InvalidSignature);
            }
            out.copy_from_slice(&signature[..64]);
            Ok((v - 27, out))
        }
        _ => Err(VowError::InvalidSignature),
    }
}

fn keccak_hash(data: &[u8]) -> [u8; 32] {
    keccak::hash(data).to_bytes()
}

fn keccak_hashv(data: &[&[u8]]) -> [u8; 32] {
    keccak::hashv(data).to_bytes()
}

fn read_array<const N: usize>(data: &[u8]) -> Result<[u8; N], VowError> {
    data.try_into().map_err(|_| VowError::InvalidVow)
}

#[cfg(test)]
mod tests {
    use super::*;
    use libsecp256k1::{PublicKey, SecretKey};

    const PRIVATE_KEY: [u8; 32] = [
        0xac, 0x09, 0x74, 0xbe, 0xc3, 0x9a, 0x17, 0xe3, 0x6b, 0xa4, 0xa6, 0xb4, 0xd2, 0x38, 0xff,
        0x94, 0x4b, 0xac, 0xb4, 0x78, 0xcb, 0xed, 0x5e, 0xfc, 0xae, 0x78, 0x4d, 0x7b, 0xf4, 0xf2,
        0xff, 0x80,
    ];
    const SIGNER: EvmAddress = [
        0xf3, 0x9f, 0xd6, 0xe5, 0x1a, 0xad, 0x88, 0xf6, 0xf4, 0xce, 0x6a, 0xb8, 0x82, 0x72, 0x79,
        0xcf, 0xff, 0xb9, 0x22, 0x66,
    ];
    const CHAIN_ID: [u8; 32] = u256(10);
    const ROOT_BLOCK_NUMBER: [u8; 32] = u256(490);
    const PROOF_NODE: [u8; 32] = [0x11; 32];
    const EXPECTED_DOMAIN_SEPARATOR: [u8; 32] = [
        0x61, 0x92, 0x10, 0x6f, 0x12, 0x9c, 0xe0, 0x5c, 0x90, 0x75, 0xd3, 0x19, 0xc1, 0xfa, 0x6e,
        0xa9, 0xb3, 0xae, 0x37, 0xcb, 0xd0, 0xc1, 0xef, 0x92, 0xe2, 0xbe, 0x71, 0x37, 0xbb, 0x07,
        0xba, 0xa1,
    ];
    const EXPECTED_LEAF: [u8; 32] = [
        0x9b, 0x80, 0x82, 0xae, 0x23, 0x1d, 0xbe, 0xc4, 0xaa, 0x54, 0x1a, 0xb9, 0x7d, 0xd4, 0x71,
        0x01, 0x93, 0xad, 0x12, 0xa0, 0x54, 0xb0, 0x64, 0x3b, 0x9e, 0x78, 0x9a, 0xe7, 0xc8, 0x8f,
        0xc3, 0xea,
    ];
    const EXPECTED_ROOT: [u8; 32] = [
        0xb3, 0x09, 0x80, 0xa9, 0x79, 0x1a, 0x1a, 0x34, 0xf6, 0x70, 0x38, 0xa2, 0x2b, 0x71, 0x84,
        0x5c, 0x2a, 0xf4, 0xba, 0x73, 0xae, 0x5e, 0x18, 0x21, 0xf3, 0x69, 0xd5, 0x33, 0x9a, 0xa6,
        0x66, 0x25,
    ];
    const EXPECTED_STRUCT_HASH: [u8; 32] = [
        0xf7, 0x09, 0x25, 0xcf, 0xdc, 0x06, 0x69, 0x40, 0x6d, 0x0b, 0xaf, 0xbf, 0x4d, 0xef, 0x63,
        0x41, 0x95, 0x87, 0x45, 0xfe, 0x81, 0x8a, 0x88, 0x8d, 0xa7, 0xcf, 0xce, 0x59, 0x17, 0x7b,
        0xc4, 0x03,
    ];
    const EXPECTED_DIGEST: [u8; 32] = [
        0x7b, 0x82, 0x6e, 0x58, 0x66, 0xb4, 0xba, 0xbf, 0x3e, 0xba, 0x6c, 0x80, 0x61, 0x2b, 0x21,
        0xa3, 0xfb, 0xb7, 0xb8, 0xd3, 0x8e, 0x4a, 0x30, 0xa0, 0x0a, 0x8f, 0xd4, 0x0c, 0xb9, 0xf1,
        0x89, 0x94,
    ];
    const NORMAL_SIGNATURE: [u8; 65] = [
        0xc9, 0xa3, 0x7a, 0x58, 0x06, 0x96, 0x17, 0x05, 0x17, 0x9b, 0x71, 0x88, 0x23, 0x29, 0x6c,
        0x66, 0x3b, 0x43, 0xcf, 0xc9, 0xc3, 0xad, 0xa8, 0x44, 0x45, 0xa9, 0x1f, 0x72, 0x93, 0x95,
        0x6d, 0xcc, 0x74, 0x5c, 0x84, 0xf5, 0xb0, 0x24, 0xe3, 0xb2, 0xb9, 0x14, 0x33, 0xd4, 0x4c,
        0x94, 0x5d, 0xd7, 0x10, 0x03, 0x02, 0x15, 0xe4, 0xc9, 0x9c, 0xcd, 0xd5, 0xab, 0xe7, 0x83,
        0x9c, 0xff, 0x8d, 0x20, 0x1b,
    ];

    struct TestDirectory {
        quorum: usize,
        signers: [[u8; 20]; 256],
    }

    impl WitnessDirectory for TestDirectory {
        fn get_quorum_set(&self, signer_indices: &[u8]) -> Result<Vec<EvmAddress>, VowError> {
            let mut signers = Vec::new();
            let mut previous = 0u8;
            for index in signer_indices {
                if *index == 0 {
                    break;
                }
                if *index <= previous {
                    return Err(VowError::SignerIndexRepeat);
                }
                previous = *index;
                let signer = self.signers[usize::from(*index)];
                if signer == [0; 20] {
                    return Err(VowError::ZeroSigner);
                }
                signers.push(signer);
            }
            if signers.len() < self.quorum {
                return Err(VowError::NoQuorum {
                    required: self.quorum,
                    signers: signers.len(),
                });
            }
            Ok(signers)
        }
    }

    const fn u256(value: u64) -> [u8; 32] {
        let bytes = value.to_be_bytes();
        let mut out = [0u8; 32];
        let mut i = 0;
        while i < 8 {
            out[24 + i] = bytes[i];
            i += 1;
        }
        out
    }

    fn event() -> Vec<u8> {
        let mut event = Vec::new();
        event.extend_from_slice(&SIGNER);
        event.push(2);
        event.extend_from_slice(&[
            0xdd, 0xf2, 0x52, 0xad, 0x1b, 0xe2, 0xc8, 0x9b, 0x69, 0xc2, 0xb0, 0x68, 0xfc, 0x37,
            0x8d, 0xaa, 0x95, 0x2b, 0xa7, 0xf1, 0x63, 0xc4, 0xa1, 0x16, 0x28, 0xf5, 0x5a, 0x4d,
            0xf5, 0x23, 0xb3, 0xef,
        ]);
        event.extend_from_slice(&[
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf3, 0x9f,
            0xd6, 0xe5, 0x1a, 0xad, 0x88, 0xf6, 0xf4, 0xce, 0x6a, 0xb8, 0x82, 0x72, 0x79, 0xcf,
            0xff, 0xb9, 0x22, 0x66,
        ]);
        event.extend_from_slice(&u256(123));
        event
    }

    fn directory(quorum: usize) -> TestDirectory {
        let mut signers = [[0u8; 20]; 256];
        signers[1] = SIGNER;
        TestDirectory { quorum, signers }
    }

    fn compact_signature() -> [u8; 64] {
        NORMAL_SIGNATURE[..64].try_into().unwrap()
    }

    fn vow(signature: &[u8]) -> Vec<u8> {
        let event = event();
        let mut vow = Vec::new();
        vow.extend_from_slice(&CHAIN_ID);
        vow.extend_from_slice(&ROOT_BLOCK_NUMBER);
        vow.push(1);
        vow.push(1);
        vow.extend_from_slice(&(event.len() as u16).to_be_bytes());
        vow.extend_from_slice(&PROOF_NODE);
        vow.push(1);
        vow.extend_from_slice(&(signature.len() as u16).to_be_bytes());
        vow.extend_from_slice(signature);
        vow.extend_from_slice(&event);
        vow
    }

    #[test]
    fn hash_vectors_match_solidity() {
        assert_eq!(bare_eip712_domain_separator(), EXPECTED_DOMAIN_SEPARATOR);
        assert_eq!(leaf_hash(&event()), EXPECTED_LEAF);
        assert_eq!(
            compute_merkle_root(&[PROOF_NODE], EXPECTED_LEAF),
            EXPECTED_ROOT
        );
        assert_eq!(
            vow_typehash(CHAIN_ID, ROOT_BLOCK_NUMBER, EXPECTED_ROOT),
            EXPECTED_STRUCT_HASH
        );
        assert_eq!(hash_typed_data(EXPECTED_STRUCT_HASH), EXPECTED_DIGEST);
    }

    #[test]
    fn process_vow_accepts_compact_signature() {
        let vow = vow(&compact_signature());
        let processed = process_vow(&directory(1), &vow).unwrap();

        assert_eq!(processed.chain_id, CHAIN_ID);
        assert_eq!(processed.root_block_number, ROOT_BLOCK_NUMBER);
        assert_eq!(processed.event, event());
    }

    #[test]
    fn process_vow_accepts_normal_evm_signature() {
        let vow = vow(&NORMAL_SIGNATURE);
        let processed = process_vow(&directory(1), &vow).unwrap();

        assert_eq!(processed.event, event());
    }

    #[test]
    fn process_vow_rejects_wrong_signer() {
        let mut directory = directory(1);
        directory.signers[1] = [0x44; 20];

        assert_eq!(
            process_vow(&directory, &vow(&compact_signature())),
            Err(VowError::InvalidlySignedRoot)
        );
    }

    #[test]
    fn process_vow_rejects_wrong_root() {
        let mut vow = vow(&compact_signature());
        vow[68] = 0x22;

        assert_eq!(
            process_vow(&directory(1), &vow),
            Err(VowError::InvalidlySignedRoot)
        );
    }

    #[test]
    fn process_vow_rejects_malformed_signature() {
        let mut signature = compact_signature().to_vec();
        signature.pop();

        assert_eq!(
            process_vow(&directory(1), &vow(&signature)),
            Err(VowError::InvalidlySignedRoot)
        );
    }

    #[test]
    fn process_vow_rejects_bad_quorum() {
        assert_eq!(
            process_vow(&directory(2), &vow(&compact_signature())),
            Err(VowError::NoQuorum {
                required: 2,
                signers: 1
            })
        );
    }

    #[test]
    fn directory_rejects_repeated_indices_and_zero_signers() {
        let mut repeated = vow(&compact_signature());
        repeated[65] = 2;
        repeated.insert(68 + 32 + 1, 1);
        assert_eq!(
            process_vow(&directory(1), &repeated),
            Err(VowError::SignerIndexRepeat)
        );

        let mut missing = vow(&compact_signature());
        missing[68 + 32] = 2;
        assert_eq!(
            process_vow(&directory(1), &missing),
            Err(VowError::ZeroSigner)
        );
    }

    #[test]
    fn decode_event_accepts_zero_to_four_topics() {
        for topic_count in 0..=4 {
            let mut event = Vec::new();
            event.extend_from_slice(&SIGNER);
            event.push(topic_count);
            for i in 0..topic_count {
                event.extend_from_slice(&[i; 32]);
            }
            event.extend_from_slice(&[0xaa, 0xbb]);

            let decoded = decode_event(&event).unwrap();
            assert_eq!(decoded.emitter, SIGNER);
            assert_eq!(decoded.topics.len(), usize::from(topic_count));
            assert_eq!(decoded.data, [0xaa, 0xbb]);
        }
    }

    #[test]
    fn decode_event_rejects_five_topics() {
        let mut event = Vec::new();
        event.extend_from_slice(&SIGNER);
        event.push(5);
        event.extend_from_slice(&[0u8; 32 * 5]);

        assert_eq!(decode_event(&event), Err(VowError::TooManyTopics));
    }

    #[test]
    fn decode_emit_cpi_roundtrips() {
        let mut event = Vec::new();
        event.extend_from_slice(&[0x77; 32]);
        event.extend_from_slice(&[0x88; 8]);
        event.extend_from_slice(&[0xaa, 0xbb, 0xcc]);

        let decoded = decode_emit_cpi(&event).unwrap();
        assert_eq!(decoded.program_id, [0x77; 32]);
        assert_eq!(decoded.discriminator, [0x88; 8]);
        assert_eq!(decoded.data, [0xaa, 0xbb, 0xcc]);
    }

    #[test]
    fn decode_emit_cpi_rejects_short_inputs() {
        assert_eq!(decode_emit_cpi(&[0u8; 39]), Err(VowError::InvalidEmitCpi));
    }

    #[test]
    fn signer_address_matches_fixture_private_key() {
        let secret = SecretKey::parse(&PRIVATE_KEY).unwrap();
        let pubkey = PublicKey::from_secret_key(&secret).serialize();
        let hash = keccak_hash(&pubkey[1..]);

        assert!(hash[12..].eq(&SIGNER));
    }
}
