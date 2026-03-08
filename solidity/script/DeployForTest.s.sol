// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import { Script } from "forge-std/Script.sol";

import { WitnessDirectory } from "../src/WitnessDirectory.sol";
import { MockVowLib } from "../src/mocks/MockVowLib.sol";
import { TestEmitter } from "../src/mocks/TestEmitter.sol";

contract DeployForTest is Script {
  function run() external {
    vm.startBroadcast();

    WitnessDirectory directory = new WitnessDirectory(msg.sender);
    // Register the broadcaster (Anvil key #0) as signer at index 1, quorum 1
    directory.setSigner(msg.sender, 1, 1);

    MockVowLib mockVowLib = new MockVowLib();
    TestEmitter testEmitter = new TestEmitter();

    vm.stopBroadcast();

    // Write addresses for TypeScript test to consume
    string memory json = string.concat(
      '{"witnessDirectory":"',
      vm.toString(address(directory)),
      '","mockVowLib":"',
      vm.toString(address(mockVowLib)),
      '","testEmitter":"',
      vm.toString(address(testEmitter)),
      '"}'
    );
    // Path is relative to the solidity/ working directory
    vm.writeFile("../witness/test/e2e/addresses.json", json);
  }
}
