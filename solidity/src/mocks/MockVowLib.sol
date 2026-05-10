// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import { VowLib } from "../VowLib.sol";

contract MockVowLib {
  function processVow(
    address directory,
    bytes calldata vow
  ) external view returns (uint256 chainId, uint256 rootBlockNumber, bytes memory evt) {
    bytes calldata _evt;
    (chainId, rootBlockNumber, _evt) = VowLib.processVow(directory, vow);
    evt = _evt;
  }

  function decodeEvent(
    bytes calldata evt
  ) external pure returns (address emitter, bytes32[] calldata topics, bytes calldata data) {
    return VowLib.decodeEvent(evt);
  }

  function decodeEmitCPI(
    bytes calldata evt
  ) external pure returns (bytes32 programId, bytes8 discriminator, bytes calldata data) {
    return VowLib.decodeEmitCPI(evt);
  }
}
