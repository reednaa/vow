// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import { Test } from "forge-std/Test.sol";

import { VowLib } from "../src/VowLib.sol";
import { WitnessDirectory } from "../src/WitnessDirectory.sol";

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

  function decodeEmitCPI(
    bytes calldata evt
  ) external pure returns (bytes32 programId, bytes8 discriminator, bytes calldata data) {
    (programId, discriminator, data) = VowLib.decodeEmitCPI(evt);
  }

  function leafHash(
    bytes calldata dat
  ) external pure returns (bytes32) {
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
  ) external view returns (uint256 chainId, uint256 rootBlockNumber, bytes calldata evt) {
    return VowLib.processVow(directry, vow);
  }

  function verifySignedVow(
    uint256 chainId,
    uint256 rootBlockNumber,
    bytes32 root,
    address[] memory signers,
    bytes[] calldata signatures
  ) external view {
    return VowLib._verifySignedVow(chainId, rootBlockNumber, root, signers, signatures);
  }

  function hashTypedData(
    bytes32 structHash
  ) external pure returns (bytes32 digest) {
    return VowLib._hashTypedData(structHash);
  }

  function vowTypehash(
    uint256 chainId,
    uint256 rootBlockNumber,
    bytes32 root
  ) external pure returns (bytes32 vowHash) {
    return VowLib.vowTypehash(chainId, rootBlockNumber, root);
  }

  /// @notice Encodes a vow in plain Solidity.
  function encodeVow(
    uint256 chainId,
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

    uint256 totalSize = 68 + P * 32 + S + sigsSize + evt.length;
    encoded = new bytes(totalSize);

    // --- Header ---
    assembly {
      let dst := add(encoded, 32) // skip length prefix
      mstore(dst, chainId)
      mstore(add(dst, 32), rootBlockNumber)
    }
    // Descriptor: P(1B) | S(1B) | E(2B) at byte 64
    encoded[64] = bytes1(uint8(P));
    encoded[65] = bytes1(uint8(S));
    encoded[66] = bytes1(uint8(evt.length >> 8));
    encoded[67] = bytes1(uint8(evt.length));

    uint256 cursor = 68;

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
      encoded[cursor] = bytes1(uint8(sLen >> 8));
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

      let totalSize := add(add(add(68, mul(P, 32)), S), add(sigsSize, evt.length))

      // Allocate
      encoded := mload(0x40)
      mstore(0x40, add(add(encoded, 0x20), totalSize))
      mstore(encoded, totalSize)

      let dst := add(encoded, 0x20)

      // --- Header (68 bytes) ---
      mstore(dst, chainId)
      mstore(add(dst, 32), rootBlockNumber)
      // Descriptor at byte 64: P(1) | S(1) | E(2) packed into 4 bytes
      // Build: P << 24 | S << 16 | E
      let descriptor := or(or(shl(24, P), shl(16, S)), evt.length)
      // Write 4 bytes at offset 64. We store a full word and it will
      // be overwritten by subsequent writes past byte 68.
      mstore(add(dst, 64), shl(224, descriptor))

      let cursor := add(dst, 68)

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

  function encodeVowExternal(
    uint256 chainId,
    uint256 rootBlockNumber,
    bytes32[] calldata proof,
    uint8[] calldata signerIndices,
    bytes[] calldata signatures,
    bytes calldata evt
  ) external pure returns (bytes memory encoded) {
    encoded = encodeVow(chainId, rootBlockNumber, proof, signerIndices, signatures, evt);
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

  function test_compare_event_encode_0_topic(
    address emitter,
    bytes calldata data
  ) external {
    bytes32[] memory ct = new bytes32[](0);

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

  function test_emitCpi_decode_roundtrip(
    bytes32 programId,
    bytes8 discriminator,
    bytes calldata data
  ) external {
    bytes memory evt = abi.encodePacked(programId, discriminator, data);

    (bytes32 decodedProgramId, bytes8 decodedDiscriminator, bytes memory decodedData) = v.decodeEmitCPI(evt);

    assertEq(programId, decodedProgramId);
    assertEq(discriminator, decodedDiscriminator);
    assertEq(data, decodedData);
  }
}

contract VowLibFindingsTest is Test {
  MockEvent v;
  WitnessDirectory directory;
  uint256 signerPk;
  address signer;
  address secondSigner;

  function setUp() external {
    v = new MockEvent();
    directory = new WitnessDirectory(address(this));

    signerPk = 0xA11CE;
    signer = vm.addr(signerPk);
    secondSigner = address(0xC0FFEE);

    // Seed the directory with deterministic test witnesses.
    directory.setSigner(signer, 1, 1);
    directory.setSigner(secondSigner, 2, 1);
  }

  // Finding: processVow does not parse P/S/E from the documented header fields.
  function test_processVow_accepts_spec_valid_payload() external {
    uint256 chainId = 10;
    uint256 rootBlockNumber = 490;

    bytes32[] memory topics = new bytes32[](2);
    topics[0] = keccak256("Topic0");
    topics[1] = keccak256("Topic1");
    bytes memory eventData = abi.encode(uint256(123), address(0xABCD));
    bytes memory evt = v.referenceEvent(address(0xBEEF), topics, eventData);

    bytes32[] memory proof = new bytes32[](1);
    proof[0] = bytes32(0);
    bytes32 leaf = v.leafHash(evt);
    bytes32 root = v.computeMerkleRootCalldata(proof, leaf);

    bytes32 digest = v.hashTypedData(v.vowTypehash(chainId, rootBlockNumber, root));
    (uint8 vv, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
    bytes[] memory signatures = new bytes[](1);
    signatures[0] = abi.encodePacked(r, s, vv);
    uint8[] memory signerIndices = new uint8[](1);
    signerIndices[0] = 1;

    bytes memory vow = v.encodeVowExternal(chainId, rootBlockNumber, proof, signerIndices, signatures, evt);

    (uint256 gotChainId, uint256 gotRootBlockNumber, bytes memory gotEvt) = v.processVow(address(directory), vow);

    (address emitter, bytes32[] memory gotTopics, bytes memory gotData) = v.decodeEvent(gotEvt);

    assertEq(gotChainId, chainId);
    assertEq(gotRootBlockNumber, rootBlockNumber);
    assertEq(gotEvt, evt);
    assertEq(emitter, address(0xBEEF));
    assertEq(gotTopics, topics);
    assertEq(gotData, eventData);
  }

  // Finding: decodeEvent accepts topic counts above 4.
  function test_revertIf_decodeEvent_has_more_than_4_topics() external {
    bytes memory evt = abi.encodePacked(
      address(0xBEEF),
      uint8(5),
      bytes32(uint256(1)),
      bytes32(uint256(2)),
      bytes32(uint256(3)),
      bytes32(uint256(4)),
      bytes32(uint256(5))
    );

    vm.expectRevert(abi.encodeWithSelector(VowLib.TooManyTopics.selector));
    v.decodeEvent(evt);
  }

  function test_revertIf_decodeEmitCPI_event_shorter_than_header() external {
    bytes memory evt = abi.encodePacked(bytes32(uint256(1)), bytes7(0));

    vm.expectRevert(abi.encodeWithSelector(VowLib.InvalidEmitCPI.selector));
    v.decodeEmitCPI(evt);
  }
}
