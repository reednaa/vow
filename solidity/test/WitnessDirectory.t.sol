// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import { Test } from "forge-std/Test.sol";

import { Ownable } from "solady/src/auth/Ownable.sol";

import { IWitnessDirectory } from "../src/IWitnessDirectory.sol";
import { WitnessDirectory } from "../src/WitnessDirectory.sol";

contract MockHarness is WitnessDirectory {
  constructor(
    address owner
  ) WitnessDirectory(owner) { }

  function setSignerInternal(
    address signer,
    uint256 index
  ) external {
    _setSigner(signer, index);
  }

  function getSignerInternal(
    uint256 index
  ) external view returns (address signer) {
    return _getSigner(index);
  }
}

contract WitnessDirectoryTest is Test {
  MockHarness d;

  address internal constant OWNER = address(0xA11CE);
  address internal constant ALICE = address(0xA11CE1);
  address internal constant BOB = address(0xB0B);
  address internal constant CAROL = address(0xCAAA01);

  function setUp() external {
    d = new MockHarness(OWNER);
  }

  function test_constructor_sets_owner() external {
    assertEq(d.owner(), OWNER);
  }

  function test_setSigner_only_owner() external {
    vm.expectRevert(Ownable.Unauthorized.selector);
    d.setSigner(ALICE, 1, 1);
  }

  function test_setSigner_updates_signer_and_quorum() external {
    vm.prank(OWNER);
    d.setSigner(ALICE, 1, 2);

    assertEq(d.getSigner(1), ALICE);

    vm.expectRevert(abi.encodeWithSelector(IWitnessDirectory.NoQourum.selector, 2, 1));
    d.getQourumSet(_indexMap(_asArray(1)));
  }

  function test_getSigner_unset_index_returns_zero() external {
    assertEq(d.getSigner(42), address(0));
  }

  function test_internal_set_get_roundtrip() external {
    d.setSignerInternal(ALICE, 7);
    assertEq(d.getSignerInternal(7), ALICE);
  }

  function test_internal_set_get_overwrite() external {
    d.setSignerInternal(ALICE, 9);
    d.setSignerInternal(BOB, 9);

    assertEq(d.getSignerInternal(9), BOB);
  }

  function test_getQourumSet_empty_map_with_zero_quorum() external {
    address[] memory signers = d.getQourumSet(0);

    assertEq(signers.length, 0);
  }

  function test_getQourumSet_empty_map_reverts_when_quorum_is_nonzero() external {
    vm.prank(OWNER);
    d.setSigner(ALICE, 1, 1);

    vm.expectRevert(abi.encodeWithSelector(IWitnessDirectory.NoQourum.selector, 1, 0));
    d.getQourumSet(0);
  }

  function test_getQourumSet_returns_signers_in_index_order() external {
    vm.startPrank(OWNER);
    d.setSigner(ALICE, 1, 2);
    d.setSigner(BOB, 2, 2);
    d.setSigner(CAROL, 3, 2);
    vm.stopPrank();

    address[] memory signers = d.getQourumSet(_indexMap(_asArray(1, 2, 3)));

    assertEq(signers.length, 3);
    assertEq(signers[0], ALICE);
    assertEq(signers[1], BOB);
    assertEq(signers[2], CAROL);
  }

  function test_getQourumSet_reverts_on_repeated_index() external {
    vm.startPrank(OWNER);
    d.setSigner(ALICE, 1, 2);
    d.setSigner(BOB, 2, 2);
    d.setSigner(CAROL, 3, 2);
    vm.stopPrank();

    vm.expectRevert(IWitnessDirectory.SignerIndexRepeat.selector);
    d.getQourumSet(_indexMap(_asArray(1, 1)));

    vm.expectRevert(IWitnessDirectory.SignerIndexRepeat.selector);
    d.getQourumSet(_indexMap(_asArray(1, 2, 1)));
  }

  function test_getQourumSet_reverts_on_zero_signer_lookup() external {
    vm.prank(OWNER);
    d.setSigner(ALICE, 1, 1);

    vm.expectRevert(IWitnessDirectory.ZeroSigner.selector);
    d.getQourumSet(_indexMap(_asArray(1, 2)));
  }

  function test_getQourumSet_reverts_when_result_is_below_quorum() external {
    vm.startPrank(OWNER);
    d.setSigner(ALICE, 1, 3);
    d.setSigner(BOB, 2, 3);
    vm.stopPrank();

    vm.expectRevert(abi.encodeWithSelector(IWitnessDirectory.NoQourum.selector, 3, 2));
    d.getQourumSet(_indexMap(_asArray(1, 2)));
  }

  function test_getQourumSet_stops_at_first_zero_index() external {
    vm.startPrank(OWNER);
    d.setSigner(ALICE, 1, 1);
    d.setSigner(BOB, 2, 1);
    vm.stopPrank();

    address[] memory signers = d.getQourumSet(_indexMap(_asArray(1, 0, 2)));

    assertEq(signers.length, 1);
    assertEq(signers[0], ALICE);
  }

  function test_revertIf_getQourumSet_indexes_not_strictly_increasing() external {
    vm.startPrank(OWNER);
    d.setSigner(ALICE, 1, 2);
    d.setSigner(BOB, 2, 2);
    vm.stopPrank();

    vm.expectRevert();
    d.getQourumSet(_indexMap(_asArray(2, 1)));
  }

  function test_getQourumSet_supports_index_255() external {
    vm.startPrank(OWNER);
    d.setSigner(ALICE, 255, 1);
    vm.stopPrank();

    address[] memory signers = d.getQourumSet(_indexMap(_asArray(255)));

    assertEq(signers.length, 1);
    assertEq(signers[0], ALICE);
  }

  // Finding: index 0 is used as a sentinel in getQourumSet and should be rejected at write time.
  function test_revertIf_setSigner_allows_index_zero() external {
    vm.prank(OWNER);
    vm.expectRevert();
    d.setSigner(ALICE, 0, 1);
  }

  // Finding: indexes above 255 collide with lower-byte indexes.
  function test_setSigner_indexes_above_255_do_not_collide() external {
    vm.startPrank(OWNER);
    d.setSigner(ALICE, 1, 0);
    vm.expectRevert(abi.encodeWithSelector(WitnessDirectory.IndexTooHigh.selector));
    d.setSigner(BOB, 257, 0);
    vm.stopPrank();

    assertEq(d.getSigner(1), ALICE);
    vm.expectRevert(abi.encodeWithSelector(WitnessDirectory.IndexTooHigh.selector));
    d.getSigner(257);
  }

  function _indexMap(
    uint8[] memory indices
  ) internal pure returns (uint256 map) {
    uint256 length = indices.length;
    for (uint256 i = 0; i < length; ++i) {
      map |= uint256(indices[i]) << (248 - i * 8);
    }
  }

  function _asArray(
    uint8 a
  ) internal pure returns (uint8[] memory out) {
    out = new uint8[](1);
    out[0] = a;
  }

  function _asArray(
    uint8 a,
    uint8 b
  ) internal pure returns (uint8[] memory out) {
    out = new uint8[](2);
    out[0] = a;
    out[1] = b;
  }

  function _asArray(
    uint8 a,
    uint8 b,
    uint8 c
  ) internal pure returns (uint8[] memory out) {
    out = new uint8[](3);
    out[0] = a;
    out[1] = b;
    out[2] = c;
  }
}
