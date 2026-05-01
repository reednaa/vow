use anchor_lang::prelude::*;

use crate::errors::VowError;

#[account]
pub struct WitnessDirectory {
    pub owner: Pubkey,
    pub quorum: u8,
    pub bump: u8,
}

impl WitnessDirectory {
    pub const LEN: usize = 8 + 32 + 1 + 1;
}

#[account]
pub struct SignerSlot {
    pub eth_address: [u8; 20],
}

impl SignerSlot {
    pub const LEN: usize = 8 + 20;
}

pub fn resolve_signer_set(
    index_map: &[u8; 32],
    witness_directory: &Account<WitnessDirectory>,
    signer_slots: &[AccountInfo],
) -> Result<(Vec<[u8; 20]>, u8)> {
    let mut signers: Vec<[u8; 20]> = Vec::new();
    let mut previous_index: u8 = 0;
    let mut count: u8 = 0;

    for i in 0..32 {
        let signer_index = index_map[i];
        if signer_index == 0 {
            break;
        }

        require!(
            signer_index > previous_index,
            VowError::SignerIndexRepeat
        );
        previous_index = signer_index;

        let slot = &signer_slots[i as usize];
        let slot_data =
            SignerSlot::try_deserialize(&mut &slot.data.borrow()[..])?;
        require!(
            slot_data.eth_address != [0u8; 20],
            VowError::ZeroSigner
        );

        signers.push(slot_data.eth_address);
        count += 1;
    }

    require!(
        count >= witness_directory.quorum,
        VowError::NoQuorum(witness_directory.quorum, count)
    );

    Ok((signers, count))
}