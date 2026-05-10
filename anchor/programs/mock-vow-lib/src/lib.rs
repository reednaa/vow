use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::set_return_data;
use vow_lib::{EvmAddress, VowError, WitnessDirectory};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkgmDEWJQzn1k");

#[program]
pub mod mock_vow_lib {
    use super::*;

    pub fn initialize_directory(ctx: Context<InitializeDirectory>, quorum: u8) -> Result<()> {
        let directory = &mut ctx.accounts.directory;
        directory.authority = ctx.accounts.authority.key();
        directory.quorum = quorum;
        directory.signers = [[0u8; 20]; 256];
        Ok(())
    }

    pub fn set_signer(
        ctx: Context<SetSigner>,
        index: u8,
        signer: EvmAddress,
        quorum: u8,
    ) -> Result<()> {
        if index == 0 {
            return err!(MockVowLibError::Index0);
        }

        let directory = &mut ctx.accounts.directory;
        directory.signers[usize::from(index)] = signer;
        directory.quorum = quorum;
        Ok(())
    }

    pub fn process_vow(ctx: Context<ProcessVow>, vow: Vec<u8>) -> Result<()> {
        let processed =
            vow_lib::process_vow(&*ctx.accounts.directory, &vow).map_err(map_vow_error)?;
        set_borsh_return(&ProcessVowReturn {
            chain_id: processed.chain_id,
            root_block_number: processed.root_block_number,
            event: processed.event.to_vec(),
        })
    }

    pub fn decode_event(_ctx: Context<Decode>, event: Vec<u8>) -> Result<()> {
        let decoded = vow_lib::decode_event(&event).map_err(map_vow_error)?;
        set_borsh_return(&DecodeEventReturn {
            emitter: decoded.emitter,
            topics: decoded.topics,
            data: decoded.data.to_vec(),
        })
    }

    pub fn decode_emit_cpi(_ctx: Context<Decode>, event: Vec<u8>) -> Result<()> {
        let decoded = vow_lib::decode_emit_cpi(&event).map_err(map_vow_error)?;
        set_borsh_return(&DecodeEmitCpiReturn {
            program_id: decoded.program_id,
            discriminator: decoded.discriminator,
            data: decoded.data.to_vec(),
        })
    }
}

#[derive(Accounts)]
pub struct InitializeDirectory<'info> {
    #[account(init, payer = authority, space = WitnessDirectoryAccount::SPACE)]
    pub directory: Account<'info, WitnessDirectoryAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetSigner<'info> {
    #[account(mut, has_one = authority)]
    pub directory: Account<'info, WitnessDirectoryAccount>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ProcessVow<'info> {
    pub directory: Account<'info, WitnessDirectoryAccount>,
}

#[derive(Accounts)]
pub struct Decode {}

#[account]
pub struct WitnessDirectoryAccount {
    pub authority: Pubkey,
    pub quorum: u8,
    pub signers: [[u8; 20]; 256],
}

impl WitnessDirectoryAccount {
    pub const SPACE: usize = 8 + 32 + 1 + (20 * 256);
}

impl WitnessDirectory for WitnessDirectoryAccount {
    fn get_quorum_set(
        &self,
        signer_indices: &[u8],
    ) -> std::result::Result<Vec<EvmAddress>, VowError> {
        let mut signers = Vec::new();
        let mut previous_index = 0u8;
        for signer_index in signer_indices {
            if *signer_index == 0 {
                break;
            }
            if *signer_index <= previous_index {
                return Err(VowError::SignerIndexRepeat);
            }
            previous_index = *signer_index;

            let signer = self.signers[usize::from(*signer_index)];
            if signer == [0u8; 20] {
                return Err(VowError::ZeroSigner);
            }
            signers.push(signer);
        }

        let quorum = usize::from(self.quorum);
        if signers.len() < quorum {
            return Err(VowError::NoQuorum {
                required: quorum,
                signers: signers.len(),
            });
        }
        Ok(signers)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct ProcessVowReturn {
    pub chain_id: [u8; 32],
    pub root_block_number: [u8; 32],
    pub event: Vec<u8>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct DecodeEventReturn {
    pub emitter: EvmAddress,
    pub topics: Vec<[u8; 32]>,
    pub data: Vec<u8>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct DecodeEmitCpiReturn {
    pub program_id: [u8; 32],
    pub discriminator: [u8; 8],
    pub data: Vec<u8>,
}

fn set_borsh_return<T: AnchorSerialize>(value: &T) -> Result<()> {
    let data = value
        .try_to_vec()
        .map_err(|_| error!(MockVowLibError::ReturnDataSerializationFailed))?;
    set_return_data(&data);
    Ok(())
}

fn map_vow_error(error: VowError) -> anchor_lang::error::Error {
    match error {
        VowError::InvalidVow => error!(MockVowLibError::InvalidVow),
        VowError::InvalidlySignedRoot => error!(MockVowLibError::InvalidlySignedRoot),
        VowError::TooManyTopics => error!(MockVowLibError::TooManyTopics),
        VowError::InvalidEmitCpi => error!(MockVowLibError::InvalidEmitCpi),
        VowError::InvalidEvent => error!(MockVowLibError::InvalidEvent),
        VowError::InvalidSignature => error!(MockVowLibError::InvalidSignature),
        VowError::SignerIndexRepeat => error!(MockVowLibError::SignerIndexRepeat),
        VowError::ZeroSigner => error!(MockVowLibError::ZeroSigner),
        VowError::NoQuorum { .. } => error!(MockVowLibError::NoQuorum),
    }
}

#[error_code]
pub enum MockVowLibError {
    #[msg("Signer index zero is reserved as the sentinel value")]
    Index0,
    #[msg("Invalid Vow payload")]
    InvalidVow,
    #[msg("Invalidly signed root")]
    InvalidlySignedRoot,
    #[msg("Too many EVM event topics")]
    TooManyTopics,
    #[msg("Invalid emit_cpi event")]
    InvalidEmitCpi,
    #[msg("Invalid event")]
    InvalidEvent,
    #[msg("Invalid signature")]
    InvalidSignature,
    #[msg("Signer indices must be strictly increasing")]
    SignerIndexRepeat,
    #[msg("Signer slot is zero")]
    ZeroSigner,
    #[msg("Not enough signers for quorum")]
    NoQuorum,
    #[msg("Failed to serialize return data")]
    ReturnDataSerializationFailed,
}
