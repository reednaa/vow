// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

contract TestEmitter {
  event TestEvent(address indexed from, bytes32 indexed tag, bytes payload);

  function emitEvent(
    bytes32 tag,
    bytes calldata payload
  ) external {
    emit TestEvent(msg.sender, tag, payload);
  }
}
