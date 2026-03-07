// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import { Ownable } from "solady/src/auth/Ownable.sol";

import { IWitnessDirectory } from "./IWitnessDirectory.sol";

/**
 * @title Witness Directory — List of witnesses requires to attest to a Vow.
 * @author Alexander (reednaa.eth)
 * @notice
 */
contract WitnessDirectory is IWitnessDirectory, Ownable {
  error Index0();
  error IndexTooHigh();

  /// bytes9(keccak256(bytes("_SIGNER_SLOT_SEED")))
  /// @dev The signer slot is given by:
  /// ```
  ///     mstore(0, index)
  ///     mstore(31, _SIGNER_SLOT_SEED)
  ///     let balanceSlot := keccak256(20, 30)
  /// ```
  uint256 private constant _SIGNER_SLOT_SEED = 0x1641a4741ae4042261;

  uint256 qourum;

  constructor(
    address owner
  ) {
    _initializeOwner(owner);
  }

  //--- Storage ---//
  function _setSigner(
    address signer,
    uint256 index
  ) internal {
    if (index == 0) revert Index0();
    if (index > type(uint8).max) revert IndexTooHigh();
    assembly ("memory-safe") {
      mstore(0x00, index) // places index at position 31.
      mstore(32, _SIGNER_SLOT_SEED) // Places _SIGNER_SLOT_SEED from 32 to 41
      let slot := keccak256(31, 42)
      // Stores signer in most significant bits of slot
      sstore(slot, shl(mul(8, 12), signer))
    }
  }

  function _getSigner(
    uint256 index
  ) internal view returns (address signer) {
    if (index == 0) revert Index0();
    if (index > type(uint8).max) revert IndexTooHigh();
    assembly ("memory-safe") {
      mstore(0x00, index) // places index at position 31.
      mstore(0x20, _SIGNER_SLOT_SEED) // Places _SIGNER_SLOT_SEED from 32 to 41
      let slot := keccak256(31, 42)
      signer := shr(mul(8, 12), sload(slot))
    }
  }

  function setSigner(
    address signer,
    uint256 index,
    uint256 _qourum
  ) external onlyOwner {
    _setSigner(signer, index);
    qourum = _qourum;
  }

  function getSigner(
    uint256 index
  ) external view returns (address signer) {
    return _getSigner(index);
  }

  /// @dev Requires strictly increasing solver indexes.
  function getQourumSet(
    uint256 indexMap
  ) external view returns (address[] memory signers) {
    assembly ("memory-safe") {
      signers := mload(0x40)
      let i := 0
      let previousIndex := 0
      for { } 1 {
        i := add(i, 1)
      } {
        let signerIndex := shr(mul(31, 8), shl(mul(i, 8), indexMap))

        if eq(signerIndex, 0) {
          break
        }
        if iszero(gt(signerIndex, previousIndex)) {
          mstore(0x00, 0xea7f2f56) // `SignerIndexRepeat()`.
          revert(0x1c, 0x04)
        }
        previousIndex := signerIndex

        mstore(0x00, signerIndex) // places index at position 31.
        mstore(0x20, _SIGNER_SLOT_SEED) // Places _SIGNER_SLOT_SEED from 32 to 41
        let slot := keccak256(31, 42)
        let signer := shr(mul(8, 12), sload(slot))
        if eq(signer, 0) {
          mstore(0x00, 0xe5c48ac5) // `ZeroSigner()`.
          revert(0x1c, 0x04)
        }

        mstore(add(signers, add(mul(i, 32), 32)), signer)
      }
      mstore(signers, i)
      mstore(0x40, add(add(signers, mul(i, 32)), 32))
    }
    // Check if there is enough signers to get qourum
    if (signers.length < qourum) revert IWitnessDirectory.NoQourum(qourum, signers.length);
  }
}
