use anchor_lang::prelude::*;

#[error_code]
pub enum VowError {
    #[msg("Invalidly signed root")]
    InvalidlySignedRoot,
    #[msg("Too many topics (max 4)")]
    TooManyTopics,
    #[msg("Signer index cannot be zero")]
    Index0,
    #[msg("No quorum: required {0}, got {1}")]
    NoQuorum(u8, u8),
    #[msg("Signer index repeat")]
    SignerIndexRepeat,
    #[msg("Zero signer at lookup")]
    ZeroSigner,
    #[msg("ECDSA secp256k1 signature verification failed")]
    InvalidSecp256k1Signature,
    #[msg("Vow payload too short")]
    VowTooShort,
}