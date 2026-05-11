// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import { Test } from "forge-std/Test.sol";

import { Ownable } from "solady/src/auth/Ownable.sol";

import { IWitnessDirectory, SignerConfig } from "../src/IWitnessDirectory.sol";
import { WitnessDirectory } from "../src/WitnessDirectory.sol";

contract MockHarness is WitnessDirectory {
  constructor(address owner) WitnessDirectory(owner) {}

  function setSignerInternal(address signer, uint256 index) external {
    _setSigner(signer, index, 0, 0xFFFFFFFFFF, 1);
  }

  function setSignerFullInternal(
    address signer,
    uint256 index,
    uint40 start,
    uint40 end,
    uint8 weight
  ) external {
    _setSigner(signer, index, start, end, weight);
  }

  function getSignerInternal(uint256 index) external view returns (address signer) {
    return _getSigner(index);
  }
}

contract WitnessDirectoryTest is Test {
  MockHarness d;

  address internal constant OWNER = address(0xA11CE);
  address internal constant ALICE = address(0xA11CE1);
  address internal constant BOB = address(0xB0B);
  address internal constant CAROL = address(0xCAAA01);

  uint40 internal constant UNLIMITED = 0xFFFFFFFFFF;

  function setUp() external {
    d = new MockHarness(OWNER);
  }

  function test_constructor_sets_owner() external {
    assertEq(d.owner(), OWNER);
  }

  function test_setSigner_only_owner() external {
    vm.expectRevert(Ownable.Unauthorized.selector);
    d.setSigner(ALICE, 1, UNLIMITED, 1);
  }

  function test_setSigner_updates_signer_and_quorum() external {
    vm.prank(OWNER);
    d.setSigner(ALICE, 1, UNLIMITED, 2);

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
    d.setSigner(ALICE, 1, UNLIMITED, 1);

    vm.expectRevert(abi.encodeWithSelector(IWitnessDirectory.NoQourum.selector, 1, 0));
    d.getQourumSet(0);
  }

  function test_getQourumSet_returns_signers_in_index_order() external {
    vm.startPrank(OWNER);
    d.setSigner(ALICE, 1, UNLIMITED, 2);
    d.setSigner(BOB, 2, UNLIMITED, 2);
    d.setSigner(CAROL, 3, UNLIMITED, 2);
    vm.stopPrank();

    address[] memory signers = d.getQourumSet(_indexMap(_asArray(1, 2, 3)));

    assertEq(signers.length, 3);
    assertEq(signers[0], ALICE);
    assertEq(signers[1], BOB);
    assertEq(signers[2], CAROL);
  }

  function test_getQourumSet_reverts_on_repeated_index() external {
    vm.startPrank(OWNER);
    d.setSigner(ALICE, 1, UNLIMITED, 2);
    d.setSigner(BOB, 2, UNLIMITED, 2);
    d.setSigner(CAROL, 3, UNLIMITED, 2);
    vm.stopPrank();

    vm.expectRevert(IWitnessDirectory.SignerIndexRepeat.selector);
    d.getQourumSet(_indexMap(_asArray(1, 1)));

    vm.expectRevert(IWitnessDirectory.SignerIndexRepeat.selector);
    d.getQourumSet(_indexMap(_asArray(1, 2, 1)));
  }

  function test_getQourumSet_reverts_on_zero_signer_lookup() external {
    vm.prank(OWNER);
    d.setSigner(ALICE, 1, UNLIMITED, 1);

    vm.expectRevert(IWitnessDirectory.ZeroSigner.selector);
    d.getQourumSet(_indexMap(_asArray(1, 2)));
  }

  function test_getQourumSet_reverts_when_result_is_below_quorum() external {
    vm.startPrank(OWNER);
    d.setSigner(ALICE, 1, UNLIMITED, 3);
    d.setSigner(BOB, 2, UNLIMITED, 3);
    vm.stopPrank();

    // Both have weight=1, so totalWeight=2 < quorum=3
    vm.expectRevert(abi.encodeWithSelector(IWitnessDirectory.NoQourum.selector, 3, 2));
    d.getQourumSet(_indexMap(_asArray(1, 2)));
  }

  function test_getQourumSet_stops_at_first_zero_index() external {
    vm.startPrank(OWNER);
    d.setSigner(ALICE, 1, UNLIMITED, 1);
    d.setSigner(BOB, 2, UNLIMITED, 1);
    vm.stopPrank();

    address[] memory signers = d.getQourumSet(_indexMap(_asArray(1, 0, 2)));

    assertEq(signers.length, 1);
    assertEq(signers[0], ALICE);
  }

  function test_revertIf_getQourumSet_indexes_not_strictly_increasing() external {
    vm.startPrank(OWNER);
    d.setSigner(ALICE, 1, UNLIMITED, 2);
    d.setSigner(BOB, 2, UNLIMITED, 2);
    vm.stopPrank();

    vm.expectRevert();
    d.getQourumSet(_indexMap(_asArray(2, 1)));
  }

  function test_getQourumSet_supports_index_255() external {
    vm.startPrank(OWNER);
    d.setSigner(ALICE, 255, UNLIMITED, 1);
    vm.stopPrank();

    address[] memory signers = d.getQourumSet(_indexMap(_asArray(255)));
    assertEq(signers.length, 1);
    assertEq(signers[0], ALICE);
  }

  function test_revertIf_setSigner_allows_index_zero() external {
    vm.prank(OWNER);
    vm.expectRevert();
    d.setSigner(ALICE, 0, UNLIMITED, 1);
  }

  function test_setSigner_indexes_above_255_do_not_collide() external {
    vm.startPrank(OWNER);
    d.setSigner(ALICE, 1, UNLIMITED, 0);
    vm.expectRevert(abi.encodeWithSelector(WitnessDirectory.IndexTooHigh.selector));
    d.setSigner(BOB, 257, UNLIMITED, 0);
    vm.stopPrank();

    assertEq(d.getSigner(1), ALICE);
    vm.expectRevert(abi.encodeWithSelector(WitnessDirectory.IndexTooHigh.selector));
    d.getSigner(257);
  }

  //--- Weight-based quorum ---//

  function test_weight_based_quorum_passes_with_mixed_weights() external {
    vm.startPrank(OWNER);
    // Big provider: weight=3
    d.setSignerFullInternal(ALICE, 1, 0, UNLIMITED, 3);
    // Small provider: weight=1
    d.setSignerFullInternal(BOB, 2, 0, UNLIMITED, 1);
    vm.stopPrank();

    // Quorum 4 = needs big(3) + small(1)
    // We'll just override via modifySignerSet
    vm.prank(OWNER);
    SignerConfig[] memory cfgs = new SignerConfig[](2);
    cfgs[0] = SignerConfig({ signer: ALICE, start: 0, end: UNLIMITED, weight: 3, index: 1 });
    cfgs[1] = SignerConfig({ signer: BOB, start: 0, end: UNLIMITED, weight: 1, index: 2 });
    d.modifySignerSet(cfgs, 4);

    address[] memory signers = d.getQourumSet(_indexMap(_asArray(1, 2)));
    assertEq(signers.length, 2);
    assertEq(signers[0], ALICE);
    assertEq(signers[1], BOB);
  }

  function test_weight_based_quorum_fails_insufficient_weight() external {
    vm.prank(OWNER);
    SignerConfig[] memory cfgs = new SignerConfig[](2);
    cfgs[0] = SignerConfig({ signer: ALICE, start: 0, end: UNLIMITED, weight: 3, index: 1 });
    cfgs[1] = SignerConfig({ signer: BOB, start: 0, end: UNLIMITED, weight: 1, index: 2 });
    d.modifySignerSet(cfgs, 5);

    // Only big provider (weight=3) < quorum=5
    vm.expectRevert(abi.encodeWithSelector(IWitnessDirectory.NoQourum.selector, 5, 3));
    d.getQourumSet(_indexMap(_asArray(1)));
  }

  function test_modifySignerSet_overwrites_existing() external {
    vm.prank(OWNER);
    d.setSigner(ALICE, 1, UNLIMITED, 1);

    vm.prank(OWNER);
    SignerConfig[] memory cfgs = new SignerConfig[](1);
    cfgs[0] = SignerConfig({ signer: BOB, start: 100, end: 200, weight: 5, index: 1 });
    d.modifySignerSet(cfgs, 5);

    assertEq(d.getSigner(1), BOB);
  }

  function test_zero_weight_reverts() external {
    vm.prank(OWNER);
    SignerConfig[] memory cfgs = new SignerConfig[](1);
    cfgs[0] = SignerConfig({ signer: ALICE, start: 0, end: UNLIMITED, weight: 0, index: 1 });

    vm.expectRevert(IWitnessDirectory.ZeroWeight.selector);
    d.modifySignerSet(cfgs, 1);
  }

  //--- Time-window validation ---//

  function test_expired_signer_skipped_in_quorum() external {
    vm.prank(OWNER);
    SignerConfig[] memory cfgs = new SignerConfig[](1);
    cfgs[0] = SignerConfig({ signer: ALICE, start: 0, end: 100, weight: 1, index: 1 });
    d.modifySignerSet(cfgs, 0);

    // Warp past end time
    vm.warp(101);

    vm.expectRevert(IWitnessDirectory.SignerTimeInvalid.selector);
    d.getQourumSet(_indexMap(_asArray(1)));
  }

  function test_future_signer_skipped_then_becomes_valid() external {
    vm.prank(OWNER);
    SignerConfig[] memory cfgs = new SignerConfig[](1);
    cfgs[0] = SignerConfig({ signer: ALICE, start: 1000, end: UNLIMITED, weight: 1, index: 1 });
    d.modifySignerSet(cfgs, 1);

    // Before start — reverts with SignerTimeInvalid
    vm.expectRevert(IWitnessDirectory.SignerTimeInvalid.selector);
    d.getQourumSet(_indexMap(_asArray(1)));

    // Warp to start time
    vm.warp(1000);
    address[] memory signers = d.getQourumSet(_indexMap(_asArray(1)));
    assertEq(signers.length, 1);
    assertEq(signers[0], ALICE);
  }

  function test_unlimited_expiry_always_valid() external {
    vm.prank(OWNER);
    d.setSigner(ALICE, 1, UNLIMITED, 1);

    // Warp far into the future
    vm.warp(1_000_000_000);

    address[] memory signers = d.getQourumSet(_indexMap(_asArray(1)));
    assertEq(signers.length, 1);
    assertEq(signers[0], ALICE);
  }

  function test_getSigner_returns_address_regardless_of_time() external {
    vm.prank(OWNER);
    SignerConfig[] memory cfgs = new SignerConfig[](1);
    cfgs[0] = SignerConfig({ signer: ALICE, start: 100, end: 200, weight: 1, index: 1 });
    d.modifySignerSet(cfgs, 0);

    // Warp past end — getSigner still returns address
    vm.warp(300);
    assertEq(d.getSigner(1), ALICE);
  }

  function test_mixed_valid_and_expired_signers() external {
    vm.startPrank(OWNER);
    // ALICE: valid forever
    d.setSignerFullInternal(ALICE, 1, 0, UNLIMITED, 1);
    // BOB: expired
    d.setSignerFullInternal(BOB, 2, 0, 50, 1);
    vm.stopPrank();

    vm.warp(100);

    // BOB is expired — must revert
    vm.expectRevert(IWitnessDirectory.SignerTimeInvalid.selector);
    d.getQourumSet(_indexMap(_asArray(1, 2)));
  }

  function test_setSigner_defaults_to_weight_1() external {
    vm.prank(OWNER);
    d.setSigner(ALICE, 1, UNLIMITED, 2);

    // weight=1 default, quorum=2 → needs 2 signers
    vm.expectRevert(abi.encodeWithSelector(IWitnessDirectory.NoQourum.selector, 2, 1));
    d.getQourumSet(_indexMap(_asArray(1)));
  }

  //--- Helpers ---//

  function _indexMap(uint8[] memory indices) internal pure returns (uint256 map) {
    uint256 length = indices.length;
    for (uint256 i = 0; i < length; ++i) {
      map |= uint256(indices[i]) << (248 - i * 8);
    }
  }

  function _asArray(uint8 a) internal pure returns (uint8[] memory out) {
    out = new uint8[](1);
    out[0] = a;
  }

  function _asArray(uint8 a, uint8 b) internal pure returns (uint8[] memory out) {
    out = new uint8[](2);
    out[0] = a;
    out[1] = b;
  }

  function _asArray(uint8 a, uint8 b, uint8 c) internal pure returns (uint8[] memory out) {
    out = new uint8[](3);
    out[0] = a;
    out[1] = b;
    out[2] = c;
  }
}
