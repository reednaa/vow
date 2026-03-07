// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

/**
 * @title Witness Directory — List of witnesses requires to attest to a Vow.
 * @author Alexander (reednaa.eth)
 * @notice
 */
interface IWitnessDirectory {
  error NoQourum(uint256 requiredQourum, uint256 signers);
  error SignerIndexRepeat(); // 0xea7f2f56
  error ZeroSigner(); // 0xe5c48ac5

  function getSigner(
    uint256 index
  ) external view returns (address signer);

  function getQourumSet(
    uint256 indexMap
  ) external view returns (address[] memory signers);
}
