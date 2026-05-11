// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

struct SignerConfig {
  address signer;
  uint40 start;
  uint40 end;
  uint8 weight;
  uint8 index;
}

/**
 * @title Witness Directory — List of witnesses requires to attest to a Vow.
 * @author Alexander (reednaa.eth)
 * @notice
 */
interface IWitnessDirectory {
  error NoQourum(uint256 requiredQourum, uint256 signers);
  error SignerIndexRepeat(); // 0xea7f2f56
  error SignerTimeInvalid(); // 0xc247baaf
  error ZeroSigner(); // 0xe5c48ac5
  error ZeroWeight();

  function getSigner(
    uint256 index
  ) external view returns (address signer);

  function getQourumSet(
    uint256 indexMap
  ) external view returns (address[] memory signers);

  function setSigner(
    address signer,
    uint256 index,
    uint40 expiry,
    uint256 _qourum
  ) external;

  function modifySignerSet(
    SignerConfig[] calldata signers,
    uint256 _qourum
  ) external;
}
