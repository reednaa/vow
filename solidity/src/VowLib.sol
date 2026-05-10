// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import { EfficientHashLib } from "solady/src/utils/EfficientHashLib.sol";
import { SignatureCheckerLib } from "solady/src/utils/SignatureCheckerLib.sol";

import { IWitnessDirectory } from "./IWitnessDirectory.sol";

struct Vow {
  uint256 chainId;
  uint256 rootBlockNumber;
  bytes32 root;
}

struct SolanaEvent {
  bytes32 programId;
  bytes8 discriminator;
  bytes data;
}

/**
 * @title Vow library
 * @author Alexander (reednaa.eth)
 */
library VowLib {
  using EfficientHashLib for uint256;
  using EfficientHashLib for bytes;
  using EfficientHashLib for bytes32;
  using EfficientHashLib for bytes32[];

  error InvalidlySignedRoot();
  error TooManyTopics(); // 0x643f8f9e
  error InvalidEmitCPI(); // 0xf4eabc02

  bytes32 private constant VOW_TYPE_HASH =
    keccak256(bytes("Vow(uint256 chainId,uint256 rootBlockNumber,bytes32 root)"));

  /// @dev `keccak256("EIP712Domain()")`.
  bytes32 internal constant _BARE_EIP712_DOMAIN_TYPEHASH =
    0x20bcc3f8105eea47d067386e42e60246e89393cd61c512edd1e87688890fb914;

  /// @dev Precomputed `keccak256(abi.encode(_BARE_EIP712_DOMAIN_TYPEHASH))`.
  bytes32 private constant _DOMAIN_SEPARATOR =
    0x6192106f129ce05c9075d319c1fa6ea9b3ae37cbd0c1ef92e2be7137bb07baa1;

  function vowTypehash(
    uint256 chainId,
    uint256 rootBlockNumber,
    bytes32 root
  ) internal pure returns (bytes32 vowHash) {
    vowHash = VOW_TYPE_HASH.hash(bytes32(chainId), bytes32(rootBlockNumber), root);
  }

  function _hashTypedData(
    bytes32 structHash
  ) internal pure returns (bytes32 digest) {
    assembly ("memory-safe") {
      let m := mload(0x40) // Load the free memory pointer.
      mstore(0x00, 0x1901) // Store "\x19\x01".
      mstore(0x20, _DOMAIN_SEPARATOR) // Store the precomputed domain separator.
      mstore(0x40, structHash) // Store the struct hash.
      digest := keccak256(0x1e, 0x42)
      mstore(0x40, m) // Restore the free memory pointer.
    }
  }

  function _verifySignedVow(
    uint256 chainId,
    uint256 rootBlockNumber,
    bytes32 root,
    address[] memory signers,
    bytes[] calldata signatures
  ) internal view {
    bytes32 digest = _hashTypedData(vowTypehash(chainId, rootBlockNumber, root));
    uint256 numSigners = signers.length;
    bool valid = true;
    for (uint256 i = 0; i < numSigners; ++i) {
      bool s = SignatureCheckerLib.isValidSignatureNowCalldata(signers[i], digest, signatures[i]);
      assembly ("memory-safe") {
        valid := and(s, valid)
      }
    }
    if (!valid) revert InvalidlySignedRoot();
  }

  //--- Vows ---//

  /**
   * ┌────────────────────────────────────────────────────────────┐
   * │                       VOW ENCODING                         │
   * ├────────────────────────────────────────────────────────────┤
   * │                                                            │
   * │  ════════════════════ FIXED HEADER (68 B) ═══════════════  │
   * │                                                            │
   * │  Byte 0                                                68  │
   * │  ┌────────────┬────────────┬────────┬─────────┬────────┐   │
   * │  │   chain    │   rootBN   │ #proof │ #signer │ evtlen │   │
   * │  │   (32 B)   │   (32 B)   │ P=(1B) │  S=(1B) │ E=(2B) │   │
   * │  └────────────┴────────────┴────────┴─────────┴────────┘   │
   * │                                                            │
   * │  ═══════════════ PROOF (P × 32 bytes) ═══════════════════  │
   * │                                                            │
   * │     Byte 68                             68 + P × 32        │
   * │         ┌──────────┬──────────┬─────┬──────────┐           │
   * │         │ proof[0] │ proof[1] │ ... │ proof[P] │           │
   * │         │ (32 B)   │ (32 B)   │     │ (32 B)   │           │
   * │         └──────────┴──────────┴─────┴──────────┘           │
   * │                                                            │
   * │  ════════════ SIGNER INDICES (S bytes) ══════════════════  │
   * │                                                            │
   * │       Byte 68 + P × 32                68 + P × 32 + S      │
   * │            ┌────────┬────────┬─────┬────────┐              │
   * │            │ idx[0] │ idx[1] │ ... │ idx[S] │              │
   * │            │ (1 B)  │ (1 B)  │     │ (1 B)  │              │
   * │            └────────┴────────┴─────┴────────┘              │
   * │                                                            │
   * │  ═══════════ SIGNATURES (variable) ══════════════════════  │
   * │                                                            │
   * │   68 + P × 32 + S                                          │
   * │     ┌─────────┬──────────┬─────┬─────────┬──────────┐      │
   * │     │ sLen[0] │  sig[0]  │ ... │ sLen[0] │  sig[S]  │      │
   * │     │  (2B)   │(sLen[0]B)│     │  (2B)   │(sLen[S]B)│      │
   * │     └─────────┴──────────┴─────┴─────────┴──────────┘      │
   * │                                                            │
   * │  ═══════════════════ EVT (E bytes) ══════════════════════  │
   * │       Byte TOTAL - E                        TOTAL          │
   * │          ┌────────────────────────────────────┐            │
   * │          │         raw event bytes            │            │
   * │          │           (E bytes)                │            │
   * │          └────────────────────────────────────┘            │
   * │                                                            │
   * │  ════════════════════════════════════════════════════════  │
   * │                                                            │
   * │  Total: 68 + S × (1 + 2) + P × 32 + Σ(sLen[i]) + E bytes   │
   * │                                                            │
   * └────────────────────────────────────────────────────────────┘
   */
  function processVow(
    address directory,
    bytes calldata vow
  ) internal view returns (uint256 chainId, uint256 rootBlockNumber, bytes calldata evt) {
    // Load the header.
    bytes32 digest;
    uint256 counter;
    uint256 numSigners;
    address[] memory signers;
    {
      uint256 psize;
      uint256 S;
      assembly ("memory-safe") {
        let varLengths := calldataload(add(vow.offset, 64))
        // Header descriptor at bytes [64..67]: P(1) | S(1) | E(2), big-endian.
        psize := shl(5, byte(0, varLengths))
        S := byte(1, varLengths)
        let E := or(shl(8, byte(2, varLengths)), byte(3, varLengths))

        evt.offset := sub(add(vow.offset, vow.length), E)
        evt.length := E

        chainId := calldataload(vow.offset)
        rootBlockNumber := calldataload(add(vow.offset, 32))
      }
      {
        bytes32 ourLeaf = _leafHash(evt);
        bytes32[] calldata proof;
        assembly ("memory-safe") {
          proof.offset := add(vow.offset, 68)
          proof.length := div(psize, 32)
        }
        bytes32 root = computeMerkleRootCalldata(proof, ourLeaf);
        
        digest = _hashTypedData(vowTypehash(chainId, rootBlockNumber, root));
      }

      // Step 2. Verify signatures.
      // qourum validation is done by directory.
      {
        uint256 signerIndexies;
        assembly ("memory-safe") {
          // We need to clean
          signerIndexies := shl(mul(sub(32, S), 8), shr(mul(sub(32, S), 8), calldataload(add(vow.offset, add(68, psize)))))
        }
        signers = IWitnessDirectory(directory).getQourumSet(signerIndexies);
      }

      numSigners = signers.length;
      assembly ("memory-safe") {
        counter := add(add(68, psize), S)
      }
    }
    bool valid = true;
    for (uint256 i = 0; i < numSigners; ++i) {
      bytes calldata signature;
      assembly ("memory-safe") {
        // The signature length is 2 bytes and is in the first 2 bytes of the word.
        let signatureLength := shr(mul(30, 8), calldataload(add(vow.offset, counter)))
        signature.length := signatureLength
        counter := add(counter, 2) // TODO: Check performance.
        signature.offset := add(vow.offset, counter)
        counter := add(counter, signatureLength)
      }
      bool s = SignatureCheckerLib.isValidSignatureNowCalldata(signers[i], digest, signature);
      assembly ("memory-safe") {
        valid := and(s, valid)
      }
    }
    if (!valid) revert InvalidlySignedRoot();
  }

  //--- Events ---//

  /**
   * ┌─────────────────────────────────────────────────────────────┐
   * │                      EVENT ENCODING                         │
   * ├─────────────────────────────────────────────────────────────┤
   * │                                                             │
   * │  Byte 0              20              21        21 + N*32    │
   * │ ┌──────────────────┬───┬─────────────────────┬────────────┐ │
   * │ │     emitter      │ N │       topics        │    data    │ │
   * │ │    (20 bytes)    │   │    (N * 32 bytes)   │   (rest)   │ │
   * │ └──────────────────┴───┴─────────────────────┴────────────┘ │
   * │                                                             │
   * │  ┌───────────────────────────────────────────────────────┐  │
   * │  │ emitter  : address   — 20 bytes, left-packed          │  │
   * │  │ N        : uint8     —  1 byte,  topic count (0–4)    │  │
   * │  │ topics   : bytes32[] — N × 32 bytes, packed           │  │
   * │  │ data     : bytes     — remaining bytes, no length pfx │  │
   * │  └───────────────────────────────────────────────────────┘  │
   * │                                                             │
   * │  Layout example: Transfer(from, to, amount)                 │
   * │  topics = [sig, from, to]  data = abi.encode(amount)        │
   * │                                                             │
   * │ ┌────────────────────┬──┬────────┬────────┬────────┬──────┐ │
   * │ │ 0xContractAddr...  │03│ topic0 │ topic1 │ topic2 │ data │ │
   * │ │      20 bytes      │1B│ 32 B   │ 32 B   │ 32 B   │ var  │ │
   * │ └────────────────────┴──┴────────┴────────┴────────┴──────┘ │
   * │ Byte 0               20 21       53       85      117       │
   * │                                                             │
   * │  Total: 21 + (N * 32) + len(data) bytes                     │
   * │  Digest: keccak256(encoded)                                 │
   * └─────────────────────────────────────────────────────────────┘
   */
  //--- Encoding ---//
  function encodeEvent(
    address emitter,
    bytes32[] calldata topics,
    bytes calldata data
  ) internal pure returns (bytes memory encodedEvent) {
    assembly ("memory-safe") {
      let numTopics32 := mul(topics.length, 32)
      // Topics has to be less than or equal to 4
      if gt(numTopics32, mul(4, 32)) {
        mstore(0x00, 0x643f8f9e) // `TooManyTopics()`.
        revert(0x1c, 0x04)
      }
      // 20 for emitter. + 1 for numTopics. 32 for each topic and then data.
      // numTopics is bounded by above.
      // todo: data.length is unbounded
      let payloadSize := add(add(21, numTopics32), data.length)

      // Get free memory pointer
      encodedEvent := mload(0x40)
      // Move the free memory pointer after our data.
      mstore(0x40, add(add(encodedEvent, payloadSize), 32))

      // Copy topics into place, including numTopics.
      calldatacopy(add(encodedEvent, 21), sub(topics.offset, 32), add(numTopics32, 32))

      // Set emitter. This overwrite the upper 31 bytes of numTopics.
      mstore(add(encodedEvent, 20), emitter)
      // Store payload size. This will overwrite the upper part of emitter such dirty bits are gone.
      mstore(encodedEvent, payloadSize)

      // Copy data in place.
      calldatacopy(add(encodedEvent, add(53, numTopics32)), data.offset, data.length)
    }
  }

  //--- Decoding ---//
  function decodeEvent(
    bytes calldata evt
  ) internal pure returns (address emitter, bytes32[] calldata topics, bytes calldata data) {
    assembly ("memory-safe") {
      // Load first word.
      let word := calldataload(evt.offset)
      // Extract the emitter from the evt.
      emitter := shr(mul(8, 12), word)
      // clear address from word and then clear beginning of topics.
      let numTopics := shr(mul(31, 8), shl(mul(20, 8), word))
      if gt(numTopics, 4) {
        mstore(0x00, 0x643f8f9e) // `TooManyTopics()`.
        revert(0x1c, 0x04)
      }
      topics.length := numTopics
      topics.offset := add(evt.offset, 21)
      // TODO: overflow
      let topicsEnd := add(mul(topics.length, 32), 21)
      data.offset := add(evt.offset, topicsEnd)
      data.length := sub(evt.length, topicsEnd)
    }
  }

  /**
   * ┌─────────────────────────────────────────────────────────────┐
   * │              SOLANA emit_cpi EVENT ENCODING                 │
   * ├─────────────────────────────────────────────────────────────┤
   * │                                                             │
   * │  Byte 0              32             40                      │
   * │ ┌────────────────────┬───────────────┬────────────────────┐ │
   * │ │     programId      │ discriminator │  borsh_event_data  │ │
   * │ │     (32 bytes)     │   (8 bytes)   │      (N bytes)     │ │
   * │ └────────────────────┴───────────────┴────────────────────┘ │
   * │                                                             │
   * │  ┌───────────────────────────────────────────────────────┐  │
   * │  │ programId     : bytes32 — 32 bytes, Ed25519 pubkey    │  │
   * │  │ discriminator : bytes8  —  8 bytes, anchor event tag  │  │
   * │  │                 sha256("event:EventName")[0..8]       │  │
   * │  │ data          : bytes   — remaining N bytes,          │  │
   * │  │                 Borsh-serialized event payload        │  │
   * │  └───────────────────────────────────────────────────────┘  │
   * │                                                             │
   * │  Total: 40 + len(data) bytes                                │
   * │  Digest: keccak256(keccak256(encoded))                      │
   * │                                                             │
   * │  Source: innerInstructions[].instructions[].data            │
   * │  after stripping the 8-byte EVENT_IX_TAG prefix.            │
   * └─────────────────────────────────────────────────────────────┘
   */
  function decodeEmitCPI(
    bytes calldata evt
  ) internal pure returns (bytes32 programId, bytes8 discriminator, bytes calldata data) {
    if (evt.length < 40) revert InvalidEmitCPI();
    assembly ("memory-safe") {
      programId := calldataload(evt.offset)
      let word2 := calldataload(add(evt.offset, 32))
      discriminator := word2
      data.offset := add(evt.offset, 40)
      data.length := sub(evt.length, 40)
    }
  }

  //--- Merkle Tree ---//

  /**
   * @dev Equivilant to keccak256(keecak256(evt)
   */
  function _leafHash(
    bytes calldata evt
  ) internal pure returns (bytes32 leaf) {
    assembly ("memory-safe") {
      let m := mload(0x40)
      calldatacopy(m, evt.offset, evt.length)
      leaf := keccak256(m, evt.length)
      mstore(0x00, leaf)
      leaf := keccak256(0x00, 0x20)
    }
  }

  /// @dev Returns whether `leaf` exists in the Merkle tree with `root`, given `proof`.
  /// attribution: Solady MerkleProofLib.verifyCalldata
  function computeMerkleRootCalldata(
    bytes32[] calldata proof,
    bytes32 leaf
  ) internal pure returns (bytes32 root) {
    assembly ("memory-safe") {
      if proof.length {
        // Left shift by 5 is equivalent to multiplying by 0x20.
        let end := add(proof.offset, shl(5, proof.length))
        // Initialize `offset` to the offset of `proof` in the calldata.
        let offset := proof.offset
        // Iterate over proof elements to compute root hash.
        for { } 1 { } {
          // Slot of `leaf` in scratch space.
          // If the condition is true: 0x20, otherwise: 0x00.
          let scratch := shl(5, gt(leaf, calldataload(offset)))
          // Store elements to hash contiguously in scratch space.
          // Scratch space is 64 bytes (0x00 - 0x3f) and both elements are 32 bytes.
          mstore(scratch, leaf)
          mstore(xor(scratch, 0x20), calldataload(offset))
          // Reuse `leaf` to store the hash to reduce stack operations.
          leaf := keccak256(0x00, 0x40)
          offset := add(offset, 0x20)
          if iszero(lt(offset, end)) {
            break
          }
        }
      }
      root := leaf
    }
  }
}
