// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import { Script, console } from "forge-std/Script.sol";

import { WitnessDirectory } from "../src/WitnessDirectory.sol";
import { MockVowLib } from "../src/mocks/MockVowLib.sol";

/**
 * @notice Deploy WitnessDirectory and MockVowLib, optionally register an initial signer.
 *
 * Required env vars:
 *   (none — deployer becomes owner)
 *
 * Optional env vars:
 *   SIGNER_ADDRESS   — address to register as the first signer (default: deployer)
 *   SIGNER_INDEX     — uint8 index for that signer               (default: 1)
 *   QUORUM           — minimum signers required                   (default: 1)
 *   REGISTER_SIGNER  — set to "false" to skip signer registration (default: true)
 *   OUTPUT_FILE      — path to write deployed addresses as JSON   (default: none)
 *
 * Usage (local Anvil):
 *   forge script script/Deploy.s.sol --broadcast --rpc-url http://127.0.0.1:8545
 *
 * Usage (live network):
 *   forge script script/Deploy.s.sol --broadcast --rpc-url $RPC_URL \
 *     --private-key $PRIVATE_KEY --verify --etherscan-api-key $ETHERSCAN_KEY
 */
contract Deploy is Script {
  function run() external {
    // ── Config ───────────────────────────────────────────────────────────────

    bool registerSigner = true;
    string memory registerSignerEnv = vm.envOr("REGISTER_SIGNER", string("true"));
    if (keccak256(bytes(registerSignerEnv)) == keccak256(bytes("false"))) {
      registerSigner = false;
    }

    uint256 signerIndex = vm.envOr("SIGNER_INDEX", uint256(1));
    uint256 quorum = vm.envOr("QUORUM", uint256(1));

    vm.startBroadcast();

    address deployer = msg.sender;
    address signerAddress = vm.envOr("SIGNER_ADDRESS", deployer);

    // ── Deploy ────────────────────────────────────────────────────────────────

    WitnessDirectory directory = new WitnessDirectory(deployer);
    MockVowLib mockVowLib = new MockVowLib();

    // ── Setup ─────────────────────────────────────────────────────────────────

    if (registerSigner) {
      directory.setSigner(signerAddress, signerIndex, quorum);
    }

    vm.stopBroadcast();

    // ── Log ───────────────────────────────────────────────────────────────────

    console.log("WitnessDirectory :", address(directory));
    console.log("MockVowLib       :", address(mockVowLib));
    console.log("Owner            :", deployer);
    if (registerSigner) {
      console.log("Signer           :", signerAddress);
      console.log("Signer index     :", signerIndex);
      console.log("Quorum           :", quorum);
    }

    // ── Write JSON (optional) ─────────────────────────────────────────────────

    string memory outputFile = vm.envOr("OUTPUT_FILE", string(""));
    if (bytes(outputFile).length > 0) {
      string memory json = string.concat(
        '{"witnessDirectory":"',
        vm.toString(address(directory)),
        '","mockVowLib":"',
        vm.toString(address(mockVowLib)),
        '","owner":"',
        vm.toString(deployer),
        '"}'
      );
      vm.writeFile(outputFile, json);
      console.log("Addresses written to", outputFile);
    }
  }
}
