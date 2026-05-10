use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::set_return_data;
use vow_lib::{
    decode_emit_cpi as decode_emit_cpi_bytes, decode_event as decode_event_bytes, parse_vow,
    process_vow as process_vow_bytes, read_signer_addresses, SignerSlotData, VowError,
    WitnessDirectoryData,
};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

const MAX_RETURN_DATA: usize = 1024;

#[account]
pub struct WitnessDirectoryAccount {
    pub owner: Pubkey,
    pub quorum: u8,
    pub bump: u8,
}

impl WitnessDirectoryAccount {
    pub const LEN: usize = 8 + WitnessDirectoryData::LEN;
}

#[account]
pub struct SignerSlotAccount {
    pub eth_address: [u8; 20],
}

impl SignerSlotAccount {
    pub const LEN: usize = 8 + SignerSlotData::LEN;
}

#[program]
pub mod mock_vow_lib {
    use super::*;

    pub fn initialize_directory(ctx: Context<InitializeDirectory>, quorum: u8) -> Result<()> {
        let directory = &mut ctx.accounts.witness_directory;
        directory.owner = ctx.accounts.owner.key();
        directory.quorum = quorum;
        directory.bump = ctx.bumps.witness_directory;
        Ok(())
    }

    pub fn set_signer(
        ctx: Context<SetSigner>,
        index: u8,
        eth_address: [u8; 20],
        quorum: u8,
    ) -> Result<()> {
        require!(index != 0, VowError::Index0);

        let directory = &mut ctx.accounts.witness_directory;
        require!(
            directory.owner == ctx.accounts.owner.key(),
            VowError::InvalidlySignedRoot,
        );

        ctx.accounts.signer_slot.eth_address = eth_address;
        directory.quorum = quorum;
        Ok(())
    }

    pub fn process_vow(ctx: Context<ProcessVow>, vow_data: Vec<u8>) -> Result<()> {
        let parsed = parse_vow(&vow_data)?;
        let signers =
            read_signer_addresses(&crate::ID, &parsed.signer_indices, ctx.remaining_accounts)?;
        let processed =
            process_vow_bytes(&vow_data, ctx.accounts.witness_directory.quorum, &signers)?;
        write_return_data(&processed)?;
        Ok(())
    }

    pub fn decode_event(_ctx: Context<NoAccounts>, evt_bytes: Vec<u8>) -> Result<()> {
        let decoded = decode_event_bytes(&evt_bytes)?;
        write_return_data(&decoded)?;
        Ok(())
    }

    pub fn decode_emit_cpi(_ctx: Context<NoAccounts>, evt_bytes: Vec<u8>) -> Result<()> {
        let decoded = decode_emit_cpi_bytes(&evt_bytes)?;
        write_return_data(&decoded)?;
        Ok(())
    }
}

fn write_return_data<T: AnchorSerialize>(value: &T) -> Result<()> {
    let mut bytes = Vec::new();
    value
        .serialize(&mut bytes)
        .map_err(|_| error!(VowError::ReturnDataTooLarge))?;
    require!(bytes.len() <= MAX_RETURN_DATA, VowError::ReturnDataTooLarge);
    set_return_data(&bytes);
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeDirectory<'info> {
    #[account(
        init,
        payer = owner,
        space = WitnessDirectoryAccount::LEN,
        seeds = [b"witness-directory"],
        bump,
    )]
    pub witness_directory: Account<'info, WitnessDirectoryAccount>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(index: u8, eth_address: [u8; 20])]
pub struct SetSigner<'info> {
    #[account(
        mut,
        seeds = [b"witness-directory"],
        bump = witness_directory.bump,
    )]
    pub witness_directory: Account<'info, WitnessDirectoryAccount>,
    #[account(
        init_if_needed,
        payer = owner,
        space = SignerSlotAccount::LEN,
        seeds = [b"signer", index.to_le_bytes().as_ref()],
        bump,
    )]
    pub signer_slot: Account<'info, SignerSlotAccount>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ProcessVow<'info> {
    #[account(
        seeds = [b"witness-directory"],
        bump = witness_directory.bump,
    )]
    pub witness_directory: Account<'info, WitnessDirectoryAccount>,
}

#[derive(Accounts)]
pub struct NoAccounts {}
