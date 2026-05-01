pub mod crypto;
pub mod directory;
pub mod errors;
pub mod vow;

use anchor_lang::prelude::*;
use crate::directory::*;
use crate::errors::VowError;
use crate::vow::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod vow_program {
    use super::*;

    pub fn initialize_directory(
        ctx: Context<InitializeDirectory>,
        quorum: u8,
    ) -> Result<()> {
        let dir = &mut ctx.accounts.witness_directory;
        dir.owner = ctx.accounts.owner.key();
        dir.quorum = quorum;
        dir.bump = ctx.bumps.witness_directory;
        Ok(())
    }

    pub fn set_signer(
        ctx: Context<SetSigner>,
        index: u8,
        eth_address: [u8; 20],
        quorum: u8,
    ) -> Result<()> {
        let dir = &mut ctx.accounts.witness_directory;
        require!(
            dir.owner == ctx.accounts.owner.key(),
            VowError::InvalidlySignedRoot
        );
        require!(index != 0, VowError::Index0);

        let slot = &mut ctx.accounts.signer_slot;
        slot.eth_address = eth_address;
        dir.quorum = quorum;
        Ok(())
    }

    pub fn process_vow(
        ctx: Context<ProcessVow>,
        vow_data: Vec<u8>,
    ) -> Result<()> {
        let parsed = parse_vow_header(&vow_data)?;

        let num_active = parsed.num_signers;
        let remaining = ctx.remaining_accounts;
        require!(remaining.len() == num_active, VowError::ZeroSigner);

        let mut stored: Vec<[u8; 20]> =
            Vec::with_capacity(num_active);
        let signer_indices_start: usize =
            VOW_HEADER_LEN + parsed.proof_size * 32;

        for i in 0..num_active {
            let idx = vow_data[signer_indices_start + i];
            require!(idx != 0, VowError::Index0);

            let (pda, _bump) = Pubkey::find_program_address(
                &[b"signer", &idx.to_le_bytes()],
                &crate::ID,
            );
            require!(
                remaining[i].key() == pda,
                VowError::InvalidlySignedRoot
            );

            let slot_data = SignerSlot::try_deserialize(
                &mut &remaining[i].data.borrow()[..],
            )?;
            require!(
                slot_data.eth_address != [0u8; 20],
                VowError::ZeroSigner
            );
            stored.push(slot_data.eth_address);
        }

        let event = process_vow_bare(
            &vow_data,
            ctx.accounts.witness_directory.quorum,
            &stored,
        )?;

        msg!(
            "Vow verified: emitter={:02x?} topics={} datalen={}",
            &event.emitter[..4],
            event.topics.len(),
            event.data.len()
        );

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeDirectory<'info> {
    #[account(
        init,
        payer = owner,
        space = WitnessDirectory::LEN,
        seeds = [b"witness-directory"],
        bump,
    )]
    pub witness_directory: Account<'info, WitnessDirectory>,
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
        bump,
    )]
    pub witness_directory: Account<'info, WitnessDirectory>,
    #[account(
        init_if_needed,
        payer = owner,
        space = SignerSlot::LEN,
        seeds = [b"signer", index.to_le_bytes().as_ref()],
        bump,
    )]
    pub signer_slot: Account<'info, SignerSlot>,
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
    pub witness_directory: Account<'info, WitnessDirectory>,
}