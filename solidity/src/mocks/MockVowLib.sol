// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import { VowLib } from "../VowLib.sol";

contract MockVowLib {
  function processVow(
    address directory,
    bytes calldata vow
  )
    external
    view
    returns (
      uint256 chainId,
      uint256 rootBlockNumber,
      address emitter,
      bytes32[] memory topics,
      bytes memory data
    )
  {
    bytes32[] calldata _topics;
    bytes calldata _data;
    (chainId, rootBlockNumber, emitter, _topics, _data) = VowLib.processVow(directory, vow);
    topics = _topics;
    data = _data;
  }
}
