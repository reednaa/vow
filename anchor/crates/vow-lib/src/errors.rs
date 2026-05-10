use anchor_lang::prelude::*;

#[error_code]
pub enum VowError {
    #[msg("Invalidly signed root")]
    InvalidlySignedRoot,
    #[msg("Too many topics (max 4)")]
    TooManyTopics,
    #[msg("Invalid emit_cpi event encoding")]
    InvalidEmitCpi,
    #[msg("Signer index cannot be zero")]
    Index0,
    #[msg("No quorum")]
    NoQuorum,
    #[msg("Signer index repeat")]
    SignerIndexRepeat,
    #[msg("Zero signer at lookup")]
    ZeroSigner,
    #[msg("ECDSA secp256k1 signature verification failed")]
    InvalidSecp256k1Signature,
    #[msg("Vow payload too short")]
    VowTooShort,
    #[msg("Borsh decode underflow")]
    BorshUnderflow,
    #[msg("Invalid UTF-8 string")]
    InvalidUtf8,
    #[msg("Mock return data exceeds Solana limits")]
    ReturnDataTooLarge,
}
