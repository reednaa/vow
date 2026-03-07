// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import { Test } from "forge-std/Test.sol";

import { VowLib } from "../src/VowLib.sol";

contract MockEvent {
  function encodeEvent(
    address emitter,
    bytes32[] calldata topics,
    bytes calldata data
  ) external pure returns (bytes memory encodedEvent) {
    encodedEvent = VowLib.encodeEvent(emitter, topics, data);
  }

  function referenceEvent(
    address emitter,
    bytes32[] calldata topics,
    bytes calldata data
  ) external pure returns (bytes memory encodedEvent) {
    encodedEvent = abi.encodePacked(emitter, uint8(topics.length), topics, data);
  }

  function decodeEvent(
    bytes calldata evt
  ) external pure returns (address emitter, bytes32[] calldata topics, bytes calldata data) {
    (emitter, topics, data) = VowLib.decodeEvent(evt);
  }

  function leafHash(bytes calldata dat) external pure returns (bytes32) {
    return VowLib._leafHash(dat);
  }

  function computeMerkleRootCalldata(
    bytes32[] calldata proof,
    bytes32 leaf
  ) external pure returns (bytes32 root) {
    return VowLib.computeMerkleRootCalldata(proof, leaf);
  }

  function processVow(
    address directry,
    bytes calldata vow
  ) external pure returns (
    uint256 chainId,
    uint256 latestBlockNumber,
    uint256 rootBlockNumber,
    address emitter,
    bytes32[] calldata topics,
    bytes calldata data
  ) external view {
    return VowLib.processVow(directory, vow);
  }

  function verifySignedVow(
    uint256 chainId,
    uint256 latestBlockNumber,
    uint256 rootBlockNumber,
    bytes32 root,
    address[] memory signers,
    bytes[] calldata signatures
  ) external view {
    return VowLib._verifySignedVow(
      chainId,
      latestBlockNumber,
      rootBlockNumber,
      root,
      signers,
      signatures
    );
  }

  function hashTypedData(
    bytes32 structHash
  ) external pure returns (bytes32 digest) {
    return VowLib.hashTypedData(structHash);
  }
  
  function vowTypehash(
    uint256 chainId,
    uint256 latestBlockNumber,
    uint256 rootBlockNumber,
    bytes32 root
  ) external pure returns (bytes32 vowHash) {
    return VowLib.vowTypehash(chainId, latestBlockNumber, rootBlockNumber, root);
  }

  /// @notice Encodes a vow in plain Solidity.
function encodeVow(
    uint256 chainId,
    uint256 latestBlockNumber,
    uint256 rootBlockNumber,
    bytes32[] calldata proof,
    uint8[] calldata signerIndices,
    bytes[] calldata signatures,
    bytes calldata evt
) internal pure returns (bytes memory encoded) {
    uint256 P = proof.length;
    uint256 S = signerIndices.length;
    require(S == signatures.length, "signer/sig mismatch");
    require(P <= 255 && S <= 255 && evt.length <= 65535);

    // Compute total sig section size: Σ(2 + sLen[i])
    uint256 sigsSize;
    for (uint256 i = 0; i < S; ++i) {
        sigsSize += 2 + signatures[i].length;
    }

    uint256 totalSize = 100 + P * 32 + S + sigsSize + evt.length;
    encoded = new bytes(totalSize);

    // --- Header ---
    assembly {
        let dst := add(encoded, 32) // skip length prefix
        mstore(dst, chainId)
        mstore(add(dst, 32), latestBlockNumber)
        mstore(add(dst, 64), rootBlockNumber)
    }
    // Descriptor: P(1B) | S(1B) | E(2B) at byte 96
    encoded[96] = bytes1(uint8(P));
    encoded[97] = bytes1(uint8(S));
    encoded[98] = bytes1(uint8(evt.length >> 8));
    encoded[99] = bytes1(uint8(evt.length));

    uint256 cursor = 100;

    // --- Proof ---
    for (uint256 i = 0; i < P; ++i) {
        bytes32 node = proof[i];
        assembly {
            mstore(add(add(encoded, 32), cursor), node)
        }
        cursor += 32;
    }

    // --- Signer Indices ---
    for (uint256 i = 0; i < S; ++i) {
        encoded[cursor] = bytes1(signerIndices[i]);
        cursor += 1;
    }

    // --- Signatures (interleaved: sLen[i] || sig[i]) ---
    for (uint256 i = 0; i < S; ++i) {
        uint256 sLen = signatures[i].length;
        // Write uint16 big-endian length
        encoded[cursor]     = bytes1(uint8(sLen >> 8));
        encoded[cursor + 1] = bytes1(uint8(sLen));
        cursor += 2;
        // Copy signature bytes
        bytes calldata sig = signatures[i];
        for (uint256 j = 0; j < sLen; ++j) {
            encoded[cursor + j] = sig[j];
        }
        cursor += sLen;
    }

    // --- EVT ---
    for (uint256 j = 0; j < evt.length; ++j) {
        encoded[cursor + j] = evt[j];
    }
}

/// @notice Encodes a vow in assembly.
function encodeVowAssembly(
    uint256 chainId,
    uint256 latestBlockNumber,
    uint256 rootBlockNumber,
    bytes32[] calldata proof,
    uint8[] calldata signerIndices,
    bytes[] calldata signatures,
    bytes calldata evt
) internal pure returns (bytes memory encoded) {
    assembly ("memory-safe") {
        let P := proof.length
        let S := signerIndices.length

        // --- Compute total signatures section size: Σ(2 + sLen[i]) ---
        let sigsSize := mul(S, 2) // S × 2 bytes for length prefixes
        for { let i := 0 } lt(i, S) { i := add(i, 1) } {
            // Each element in bytes[] calldata: offset at signatures.offset + i*32
            // points to a (length, data) pair relative to the start of the array.
            let relOffset := calldataload(add(signatures.offset, mul(i, 0x20)))
            let sigLen := calldataload(add(signatures.offset, relOffset))
            sigsSize := add(sigsSize, sigLen)
        }

        let totalSize := add(add(add(100, mul(P, 32)), S), add(sigsSize, evt.length))

        // Allocate
        encoded := mload(0x40)
        mstore(0x40, add(add(encoded, 0x20), totalSize))
        mstore(encoded, totalSize)

        let dst := add(encoded, 0x20)

        // --- Header (100 bytes) ---
        mstore(dst, chainId)
        mstore(add(dst, 32), latestBlockNumber)
        mstore(add(dst, 64), rootBlockNumber)
        // Descriptor at byte 96: P(1) | S(1) | E(2) packed into 4 bytes
        // Build: P << 24 | S << 16 | E
        let descriptor := or(or(shl(24, P), shl(16, S)), evt.length)
        // Write 4 bytes at offset 96. We store a full word and it will
        // be overwritten by subsequent writes past byte 100.
        mstore(add(dst, 96), shl(224, descriptor))

        let cursor := add(dst, 100)

        // --- Proof (P × 32 bytes) ---
        calldatacopy(cursor, proof.offset, mul(P, 32))
        cursor := add(cursor, mul(P, 32))

        // --- Signer Indices (S bytes) ---
        calldatacopy(cursor, signerIndices.offset, S)
        cursor := add(cursor, S)

        // --- Signatures (interleaved: uint16 len || sig data) ---
        for { let i := 0 } lt(i, S) { i := add(i, 1) } {
            let relOffset := calldataload(add(signatures.offset, mul(i, 0x20)))
            let sigDataOffset := add(signatures.offset, add(relOffset, 0x20))
            let sigLen := calldataload(add(signatures.offset, relOffset))

            // Write uint16 big-endian length (2 bytes)
            mstore(cursor, shl(240, sigLen))
            cursor := add(cursor, 2)

            // Copy signature data
            calldatacopy(cursor, sigDataOffset, sigLen)
            cursor := add(cursor, sigLen)
        }

        // --- EVT ---
        calldatacopy(cursor, evt.offset, evt.length)

        // Clean the last word (zero out any trailing garbage)
        mstore(add(add(dst, totalSize), 0), 0)
    }
}
}

contract EventLibTest is Test {
  MockEvent v;

  function setUp() external {
    v = new MockEvent();
  }

  function test_compare_event_encode_1_topic(
    address emitter,
    bytes32[1] calldata topics,
    bytes calldata data
  ) external {
    bytes32[] memory ct = new bytes32[](1);
    ct[0] = topics[0];

    bytes memory referenceEncode = v.referenceEvent(emitter, ct, data);
    bytes memory libEncode = v.encodeEvent(emitter, ct, data);

    assertEq(referenceEncode, libEncode);
  }

  function test_compare_event_encode_2_topic(
    address emitter,
    bytes32[2] calldata topics,
    bytes calldata data
  ) external {
    bytes32[] memory ct = new bytes32[](2);
    ct[0] = topics[0];
    ct[1] = topics[1];

    bytes memory referenceEncode = v.referenceEvent(emitter, ct, data);
    bytes memory libEncode = v.encodeEvent(emitter, ct, data);

    assertEq(referenceEncode, libEncode);
  }

  function test_compare_event_encode_3_topic(
    address emitter,
    bytes32[3] calldata topics,
    bytes calldata data
  ) external {
    bytes32[] memory ct = new bytes32[](3);
    ct[0] = topics[0];
    ct[1] = topics[1];
    ct[2] = topics[2];

    bytes memory referenceEncode = v.referenceEvent(emitter, ct, data);
    bytes memory libEncode = v.encodeEvent(emitter, ct, data);

    assertEq(referenceEncode, libEncode);
  }

  function test_compare_event_encode_4_topic(
    address emitter,
    bytes32[4] calldata topics,
    bytes calldata data
  ) external {
    bytes32[] memory ct = new bytes32[](4);
    ct[0] = topics[0];
    ct[1] = topics[1];
    ct[2] = topics[2];
    ct[3] = topics[3];

    bytes memory referenceEncode = v.referenceEvent(emitter, ct, data);
    bytes memory libEncode = v.encodeEvent(emitter, ct, data);

    assertEq(referenceEncode, libEncode);
  }

  function test_event_decode_4_topics(
    address emitter,
    bytes32[4] calldata topics,
    bytes calldata data
  ) external {
    bytes32[] memory ct = new bytes32[](4);
    ct[0] = topics[0];
    ct[1] = topics[1];
    ct[2] = topics[2];
    ct[3] = topics[3];

    bytes memory evt = v.referenceEvent(emitter, ct, data);

    (address decodedEmitter, bytes32[] memory decodedTopics, bytes memory decodedData) = v.decodeEvent(evt);

    assertEq(emitter, decodedEmitter);
    assertEq(ct, decodedTopics);
    assertEq(data, decodedData);
  }
}
