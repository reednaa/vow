// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import { Ownable } from "solady/src/auth/Ownable.sol";

import { IWitnessDirectory, SignerConfig } from "./IWitnessDirectory.sol";

/**
 * @title Witness Directory
 * @author Alexander (reednaa.eth)
 * @notice On-chain registry of authorised signers for the Vow attestation protocol.
 *
 * Each signer is stored in a deterministic slot (keyed by a uint8 index) as a
 * single packed word:
 *
 *   address(20) | start(5) | end(5) | weight(1)
 *
 * - `start` / `end` are uint40 UNIX timestamps defining the signer's validity window.
 * - `end == 0xFFFFFFFFFF` means unlimited expiry.
 * - `weight` (uint8) counts toward quorum — a signer with weight 3 contributes 3
 *   "votes" rather than 1.
 *
 * `getQourumSet` resolves a packed index map into an array of currently-valid
 * signer addresses and checks that the summed weight meets the configured quorum.
 * Any signer outside its time window causes the entire resolution to revert
 * (the caller should exclude stale signers from the index map).
 */
contract WitnessDirectory is IWitnessDirectory, Ownable {
  error Index0();
  error IndexTooHigh();

  /// @dev bytes9(keccak256("_SIGNER_SLOT_SEED"))
  uint256 private constant _SIGNER_SLOT_SEED = 0x1641a4741ae4042261;

  /// @notice Minimum total weight required for a valid quorum set.
  uint256 qourum;

  /// @notice Deploys the directory and sets the owner.
  /// @param owner Address that will own the directory (onlyOwner).
  constructor(address owner) {
    _initializeOwner(owner);
  }

  //--- Storage ---//

  /**
   * @notice Persist a full signer record into its deterministic slot.
   * @param signer  Address of the signer.
   * @param index   Unique uint8 index (1–255). Index 0 is reserved.
   * @param start   Unix timestamp when the signer becomes valid (inclusive).
   * @param end     Unix timestamp when the signer expires (inclusive).
   *                0xFFFFFFFFFF = unlimited.
   * @param weight  Quorum weight contributed by this signer. Must be >= 1.
   * @dev Slot is `keccak256(index || _SIGNER_SLOT_SEED)`.
   */
  function _setSigner(address signer, uint256 index, uint40 start, uint40 end, uint8 weight) internal {
    if (index == 0) revert Index0();
    if (index > type(uint8).max) revert IndexTooHigh();
    if (weight == 0) revert IWitnessDirectory.ZeroWeight();
    assembly ("memory-safe") {
      mstore(0x00, index)
      mstore(32, _SIGNER_SLOT_SEED)
      let slot := keccak256(31, 42)
      // Pack: address(20) | start(5) | end(5) | weight(1) into one word
      sstore(slot, or(or(or(shl(96, signer), shl(56, start)), shl(16, end)), shl(8, weight)))
    }
  }

  /// @notice Read just the signer address from a slot (always readable regardless of time window).
  /// @param index Signer index (1–255).
  /// @return signer The stored address, or address(0) if unset.
  function _getSigner(uint256 index) internal view returns (address signer) {
    if (index == 0) revert Index0();
    if (index > type(uint8).max) revert IndexTooHigh();
    assembly ("memory-safe") {
      mstore(0x00, index)
      mstore(0x20, _SIGNER_SLOT_SEED)
      let slot := keccak256(31, 42)
      signer := shr(96, sload(slot))
    }
  }

  //--- Public ---//

  /**
   * @notice Convenience setter — registers a signer with weight 1, active from
   *         block 0 through the given expiry.
   * @param signer  Address of the signer.
   * @param index   Unique uint8 index (1–255).
   * @param expiry  Expiration timestamp (inclusive). 0xFFFFFFFFFF = unlimited.
   * @param _qourum New quorum value (minimum total weight).
   */
  function setSigner(address signer, uint256 index, uint40 expiry, uint256 _qourum) external onlyOwner {
    _setSigner(signer, index, 0, expiry, 1);
    qourum = _qourum;
  }

  /**
   * @notice Batch-configure multiple signers with full control over time windows
   *         and weights, then set the quorum.
   * @param signers Array of signer configurations.
   * @param _qourum New quorum value (minimum total weight).
   */
  function modifySignerSet(SignerConfig[] calldata signers, uint256 _qourum) external onlyOwner {
    for (uint256 i = 0; i < signers.length; ++i) {
      SignerConfig calldata cfg = signers[i];
      _setSigner(cfg.signer, cfg.index, cfg.start, cfg.end, cfg.weight);
    }
    qourum = _qourum;
  }

  /// @notice Returns the signer address at the given index, regardless of time window.
  /// @param index Signer index (1–255).
  /// @return signer The stored address, or address(0) if unset.
  function getSigner(uint256 index) external view returns (address signer) {
    return _getSigner(index);
  }

  /**
   * @notice Resolves a packed index map into an array of currently-valid signer
   *         addresses and verifies that their total weight meets the quorum.
   *
   * The index map encodes signer indices as consecutive big-endian bytes in a
   * uint256.  Iteration stops at the first zero byte, so indices must be
   * left-packed and strictly increasing.
   *
   * Reverts if any included signer is outside its time window (callers should
   * exclude stale signers from the map).
   *
   * @param indexMap Packed uint256 of signer index bytes (big-endian).
   * @return signers Array of resolved signer addresses.
   */
  function getQourumSet(uint256 indexMap) external view returns (address[] memory signers) {
    uint256 totalWeight;
    assembly ("memory-safe") {
      signers := mload(0x40)
      let currentTime := timestamp()
      let validCount := 0
      let tw := 0
      let previousIndex := 0
      let bytePos := 0

      for {} 1 { bytePos := add(bytePos, 1) } {
        let signerIndex := shr(mul(31, 8), shl(mul(bytePos, 8), indexMap))

        if eq(signerIndex, 0) { break }
        if iszero(gt(signerIndex, previousIndex)) {
          mstore(0x00, 0xea7f2f56) // `SignerIndexRepeat()`.
          revert(0x1c, 0x04)
        }
        previousIndex := signerIndex

        mstore(0x00, signerIndex)
        mstore(0x20, _SIGNER_SLOT_SEED)
        let slot := keccak256(31, 42)
        let packed := sload(slot)

        let signer := shr(96, packed)
        if eq(signer, 0) {
          mstore(0x00, 0xe5c48ac5) // `ZeroSigner()`.
          revert(0x1c, 0x04)
        }

        let start_ := and(shr(56, packed), 0xFFFFFFFFFF)
        let end_ := and(shr(16, packed), 0xFFFFFFFFFF)
        let weight := and(shr(8, packed), 0xFF)

        // start must be <= currentTime (not in the future)
        if lt(currentTime, start_) {
          mstore(0x00, 0xc247baaf) // `SignerTimeInvalid()`.
          revert(0x1c, 0x04)
        }
        // currentTime must be <= end (not expired)
        if lt(end_, currentTime) {
          mstore(0x00, 0xc247baaf) // `SignerTimeInvalid()`.
          revert(0x1c, 0x04)
        }

        mstore(add(signers, add(mul(validCount, 32), 32)), signer)
        tw := add(tw, weight)
        validCount := add(validCount, 1)
      }
      mstore(signers, validCount)
      mstore(0x40, add(add(signers, mul(validCount, 32)), 32))
      totalWeight := tw
    }
    if (totalWeight < qourum) revert IWitnessDirectory.NoQourum(qourum, totalWeight);
  }
}
