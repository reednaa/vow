// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import { Test, console2 } from "forge-std/Test.sol";
import { LibZip } from "solady/src/utils/LibZip.sol";

contract VowCompressionTest is Test {
  function test_vowCompressionMetrics() external view {
    bytes memory vow = _vow();

    uint256 vowGas;
    {
      {
        uint256 vowZeroBytes; uint256 vowNonZeroBytes;
        (vowGas, vowZeroBytes, vowNonZeroBytes) = _calldataGas(vow);

        console2.log("Vow bytes:", vow.length);
        console2.log("Vow calldata gas:", vowGas);
        console2.log("Vow zero bytes:", vowZeroBytes);
        console2.log("Vow non-zero bytes:", vowNonZeroBytes);
      }

      {
        bytes memory cdCompressed = LibZip.cdCompress(vow);
        uint256 cdDecompressStart = gasleft();
        bytes memory cdRoundTrip = LibZip.cdDecompress(cdCompressed);
        uint256 cdDecompressGas = cdDecompressStart - gasleft();
        assertEq(cdRoundTrip, vow);
        (uint256 cdGas, uint256 cdZeroBytes, uint256 cdNonZeroBytes) = _calldataGas(cdCompressed);

        console2.log("cdCompress bytes:", cdCompressed.length);
        console2.log("cdCompress calldata gas:", cdGas);
        console2.log("cdCompress zero bytes:", cdZeroBytes);
        console2.log("cdCompress non-zero bytes:", cdNonZeroBytes);

        if (cdCompressed.length <= vow.length) {
          console2.log("cdCompress size saved:", vow.length - cdCompressed.length);
        } else {
          console2.log("cdCompress size overhead:", cdCompressed.length - vow.length);
        }
        if (cdGas <= vowGas) {
          console2.log("cdCompress gas saved:", vowGas - cdGas);
        } else {
          console2.log("cdCompress gas overhead:", cdGas - vowGas);
        }
        console2.log("cdDecompress execution gas:", cdDecompressGas);
      }

      {
         bytes memory flzCompressed = LibZip.flzCompress(vow);
        uint256 flzDecompressStart = gasleft();
        bytes memory flzRoundTrip = LibZip.flzDecompress(flzCompressed);
        uint256 flzDecompressGas = flzDecompressStart - gasleft();
        assertEq(flzRoundTrip, vow);
        (uint256 flzGas, uint256 flzZeroBytes, uint256 flzNonZeroBytes) = _calldataGas(flzCompressed);

        console2.log("flzCompress bytes:", flzCompressed.length);
        console2.log("flzCompress calldata gas:", flzGas);
        console2.log("flzCompress zero bytes:", flzZeroBytes);
        console2.log("flzCompress non-zero bytes:", flzNonZeroBytes);
        if (flzCompressed.length <= vow.length) {
          console2.log("flzCompress size saved:", vow.length - flzCompressed.length);
        } else {
          console2.log("flzCompress size overhead:", flzCompressed.length - vow.length);
        }
        if (flzGas <= vowGas) {
          console2.log("flzCompress gas saved:", vowGas - flzGas);
        } else {
          console2.log("flzCompress gas overhead:", flzGas - vowGas);
        }
        console2.log("flzDecompress execution gas:", flzDecompressGas);
      }
    }


    
  }

  function _calldataGas(
    bytes memory data
  ) internal pure returns (uint256 gasCost, uint256 zeroBytes, uint256 nonZeroBytes) {
    uint256 length = data.length;
    for (uint256 i = 0; i < length; ++i) {
      if (data[i] == bytes1(0)) {
        ++zeroBytes;
      } else {
        ++nonZeroBytes;
      }
    }
    gasCost = zeroBytes * 4 + nonZeroBytes * 16;
  }

  function _vow() internal pure returns (bytes memory vow) {
    vow =
      hex"000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000017606060a0100f5ab25e69672c1fed10e185079b3c309b787a28ebb4f50c005b528c2afb4cff2630a7ce13f9d1b590455bc159327402fd1a9262ce58cebaad492dbf6ddbf4a7790a3327e7899a8663870e2a4501a8e76492ec9138c2a5a7a46fdb7cef626a4574dae41e0cd61e5dcc0c345a6cf541c91aea8b0404b84f4a232f1681abb79827df25945b2d6a9f564eebb077e52c2fcf5d79e64e86f5a5b4cd8d5bc30f33723be925e9ae472904b140308f6fb6ccb236947b861b652b78076d154c04dadc51b6b4e6e96a7055e27f79bc54d7d299c225e807ae7d9d00164322a05cbd717ce74237e262c4f3ba3aba9ee282e3e246ee9db3ce3f83281bd3af203ababd2f2a85b0f5da0f0180729cbaa245b40648801b166caecb7c6c41c00109742c911451dc27ba1c5554f8eedd761eb560eee6199ce4d2a9be559fda89309906080dd856db691de010041e63904cd32ca9deacfe282ca94cd9c7c55bc2956e5d4ede506f662eeb2e3002126757ceb87fe83f030ce27286f0b687eebf32d70bcd3a220b390d6967a429e961bd735fb18366867cb00e8c03075fecfc74dcaa48003d78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d82200000000000000000000000066a9893cc07d91d95644aedd05d03f95e1dba8af00000000000000000000000066a9893cc07d91d95644aedd05d03f95e1dba8af00000000000000000000000000000000000000000000000006cb689b220800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000048babc777e68da6c";
  }
}
