// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import { Test, console2 } from "forge-std/Test.sol";

import { WitnessDirectory } from "../src/WitnessDirectory.sol";
import { MockEvent } from "./VowLib.t.sol";

/**
 * @notice Gas estimation tests for processVow under realistic scenarios.
 *
 * Scenarios:
 *   A) 1 signer, proof depth 0 (leaf IS the root, single-leaf tree)
 *   B) 1 signer, proof depth 10 (1024-leaf tree)
 *   C) 2 signers, proof depth 0
 *   D) 2 signers, proof depth 10
 *
 * Event used in every case:
 *   Transfer(address indexed from, address indexed to, uint256 amount)
 *   3 topics, 32 bytes data → evt = 21 + 3*32 + 32 = 149 bytes
 */
contract GasEstimateTest is Test {
  WitnessDirectory directory;
  MockEvent helper;

  uint256 pk1 = 0xA11CE;
  uint256 pk2 = 0xB0B;
  address signer1;
  address signer2;

  uint256 constant CHAIN_ID = 1;
  uint256 constant ROOT_BLOCK = 21_000_000;

  /// Canonical Transfer-like event bytes (3 topics + 32 bytes data).
  bytes evtBytes;
  bytes32 leaf;

  function setUp() external {
    signer1 = vm.addr(pk1);
    signer2 = vm.addr(pk2);
    helper = new MockEvent();

    // Default directory has only signer1, quorum=1 (used by 1-signer tests).
    directory = new WitnessDirectory(address(this));
    directory.setSigner(signer1, 1, 1);

    // Build a realistic event: Transfer(from, to, amount)
    bytes32[] memory topics = new bytes32[](3);
    topics[0] = keccak256("Transfer(address,address,uint256)");
    topics[1] = bytes32(uint256(uint160(address(0xAA))));
    topics[2] = bytes32(uint256(uint160(address(0xBB))));
    bytes memory data = abi.encode(uint256(1e18));

    evtBytes = abi.encodePacked(address(0xC0FFEE), uint8(3), topics[0], topics[1], topics[2], data);
    leaf = helper.leafHash(evtBytes);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  /// Build a proof path of `depth` zero-siblings and compute the resulting root.
  function _buildProofAndRoot(
    uint256 depth
  ) internal view returns (bytes32[] memory proof, bytes32 root) {
    proof = new bytes32[](depth);
    root = leaf;
    for (uint256 i = 0; i < depth; ++i) {
      bytes32 sibling = bytes32(uint256(i + 1)); // distinct non-zero siblings
      proof[i] = sibling;
      // Sorted-pair hash (same as computeMerkleRootCalldata)
      if (root <= sibling) root = keccak256(abi.encodePacked(root, sibling));
      else root = keccak256(abi.encodePacked(sibling, root));
    }
  }

  function _sign(
    uint256 pk,
    bytes32 root
  ) internal view returns (bytes memory sig) {
    bytes32 digest = helper.hashTypedData(helper.vowTypehash(CHAIN_ID, ROOT_BLOCK, root));
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
    sig = abi.encodePacked(r, s, v);
  }

  function _encodeVow(
    bytes32[] memory proof,
    uint8[] memory indices,
    bytes[] memory sigs
  ) internal view returns (bytes memory vow) {
    uint256 P = proof.length;
    uint256 S = indices.length;
    uint256 evtLen = evtBytes.length;

    // Compute sigs section size
    uint256 sigsSize;
    for (uint256 i = 0; i < S; ++i) {
      sigsSize += 2 + sigs[i].length;
    }

    uint256 total = 68 + P * 32 + S + sigsSize + evtLen;
    vow = new bytes(total);

    assembly {
      let dst := add(vow, 32)
      mstore(dst, CHAIN_ID)
      mstore(add(dst, 32), ROOT_BLOCK)
    }
    vow[64] = bytes1(uint8(P));
    vow[65] = bytes1(uint8(S));
    vow[66] = bytes1(uint8(evtLen >> 8));
    vow[67] = bytes1(uint8(evtLen));

    uint256 cursor = 68;
    for (uint256 i = 0; i < P; ++i) {
      bytes32 node = proof[i];
      assembly { mstore(add(add(vow, 32), cursor), node) }
      cursor += 32;
    }
    for (uint256 i = 0; i < S; ++i) {
      vow[cursor] = bytes1(indices[i]);
      cursor += 1;
    }
    for (uint256 i = 0; i < S; ++i) {
      uint256 sl = sigs[i].length;
      vow[cursor] = bytes1(uint8(sl >> 8));
      vow[cursor + 1] = bytes1(uint8(sl));
      cursor += 2;
      for (uint256 j = 0; j < sl; ++j) {
        vow[cursor + j] = sigs[i][j];
      }
      cursor += sl;
    }
    for (uint256 j = 0; j < evtLen; ++j) {
      vow[cursor + j] = evtBytes[j];
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario A: 1 signer, proof depth 0
  // ─────────────────────────────────────────────────────────────────────────
  function test_gas_1signer_depth0() external {
    (bytes32[] memory proof, bytes32 root) = _buildProofAndRoot(0);
    bytes[] memory sigs = new bytes[](1);
    sigs[0] = _sign(pk1, root);
    uint8[] memory indices = new uint8[](1);
    indices[0] = 1;

    bytes memory vow = _encodeVow(proof, indices, sigs);

    uint256 g = gasleft();
    helper.processVow(address(directory), vow);
    uint256 used = g - gasleft();
    console2.log("A) 1 signer, depth 0:", used, "gas");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario B: 1 signer, proof depth 10
  // ─────────────────────────────────────────────────────────────────────────
  function test_gas_1signer_depth10() external {
    (bytes32[] memory proof, bytes32 root) = _buildProofAndRoot(10);
    bytes[] memory sigs = new bytes[](1);
    sigs[0] = _sign(pk1, root);
    uint8[] memory indices = new uint8[](1);
    indices[0] = 1;

    bytes memory vow = _encodeVow(proof, indices, sigs);

    uint256 g = gasleft();
    helper.processVow(address(directory), vow);
    uint256 used = g - gasleft();
    console2.log("B) 1 signer, depth 10:", used, "gas");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario C: 2 signers, proof depth 0
  // ─────────────────────────────────────────────────────────────────────────
  function test_gas_2signers_depth0() external {
    // Need quorum=2 — re-initialise directory
    directory = new WitnessDirectory(address(this));
    directory.setSigner(signer1, 1, 1);
    directory.setSigner(signer2, 2, 2); // setSigner updates quorum; final quorum = 2

    (bytes32[] memory proof, bytes32 root) = _buildProofAndRoot(0);
    bytes[] memory sigs = new bytes[](2);
    sigs[0] = _sign(pk1, root);
    sigs[1] = _sign(pk2, root);
    uint8[] memory indices = new uint8[](2);
    indices[0] = 1;
    indices[1] = 2;

    bytes memory vow = _encodeVow(proof, indices, sigs);

    uint256 g = gasleft();
    helper.processVow(address(directory), vow);
    uint256 used = g - gasleft();
    console2.log("C) 2 signers, depth 0:", used, "gas");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario D: 2 signers, proof depth 10
  // ─────────────────────────────────────────────────────────────────────────
  function test_gas_2signers_depth10() external {
    directory = new WitnessDirectory(address(this));
    directory.setSigner(signer1, 1, 1);
    directory.setSigner(signer2, 2, 2);

    (bytes32[] memory proof, bytes32 root) = _buildProofAndRoot(10);
    bytes[] memory sigs = new bytes[](2);
    sigs[0] = _sign(pk1, root);
    sigs[1] = _sign(pk2, root);
    uint8[] memory indices = new uint8[](2);
    indices[0] = 1;
    indices[1] = 2;

    bytes memory vow = _encodeVow(proof, indices, sigs);

    uint256 g = gasleft();
    helper.processVow(address(directory), vow);
    uint256 used = g - gasleft();
    console2.log("D) 2 signers, depth 10:", used, "gas");
  }
}
