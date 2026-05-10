use anchor_lang::prelude::*;

use crate::errors::VowError;

const ACCOUNT_DISCRIMINATOR_LEN: usize = 8;

#[derive(Clone, Debug, PartialEq, Eq, AnchorSerialize, AnchorDeserialize)]
pub struct WitnessDirectoryData {
    pub owner: Pubkey,
    pub quorum: u8,
    pub bump: u8,
}

impl WitnessDirectoryData {
    pub const LEN: usize = 32 + 1 + 1;
}

#[derive(Clone, Debug, PartialEq, Eq, AnchorSerialize, AnchorDeserialize)]
pub struct SignerSlotData {
    pub eth_address: [u8; 20],
}

impl SignerSlotData {
    pub const LEN: usize = 20;
}

pub fn ensure_quorum(quorum: u8, signer_count: usize) -> Result<()> {
    require!(signer_count >= quorum as usize, VowError::NoQuorum);
    Ok(())
}

pub fn read_signer_addresses(
    program_id: &Pubkey,
    signer_indices: &[u8],
    signer_slot_accounts: &[AccountInfo],
) -> Result<Vec<[u8; 20]>> {
    require!(
        signer_indices.len() == signer_slot_accounts.len(),
        VowError::ZeroSigner,
    );

    let mut signers = Vec::with_capacity(signer_indices.len());
    let mut previous_index = 0u8;

    for (i, signer_index) in signer_indices.iter().copied().enumerate() {
        require!(signer_index != 0, VowError::Index0);
        require!(signer_index > previous_index, VowError::SignerIndexRepeat);
        previous_index = signer_index;

        let expected_pda = Pubkey::find_program_address(
            &[b"signer", signer_index.to_le_bytes().as_ref()],
            program_id,
        )
        .0;
        require!(
            signer_slot_accounts[i].key() == expected_pda,
            VowError::InvalidlySignedRoot,
        );

        let signer_slot_data = signer_slot_accounts[i].data.borrow();
        require!(
            signer_slot_data.len() >= ACCOUNT_DISCRIMINATOR_LEN,
            VowError::ZeroSigner,
        );
        let signer_slot =
            SignerSlotData::try_from_slice(&signer_slot_data[ACCOUNT_DISCRIMINATOR_LEN..])
                .map_err(|_| error!(VowError::ZeroSigner))?;
        require!(signer_slot.eth_address != [0u8; 20], VowError::ZeroSigner);
        signers.push(signer_slot.eth_address);
    }

    Ok(signers)
}
