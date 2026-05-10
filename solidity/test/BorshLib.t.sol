// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Test} from "forge-std/Test.sol";

import {BorshLib} from "../src/BorshLib.sol";

contract BorshHarness {
    function readU8(
        bytes calldata data,
        uint256 offset
    ) external pure returns (uint8 value, uint256 newOffset) {
        return BorshLib.readU8(data, offset);
    }

    function readU16(
        bytes calldata data,
        uint256 offset
    ) external pure returns (uint16 value, uint256 newOffset) {
        return BorshLib.readU16(data, offset);
    }

    function readU32(
        bytes calldata data,
        uint256 offset
    ) external pure returns (uint32 value, uint256 newOffset) {
        return BorshLib.readU32(data, offset);
    }

    function readU64(
        bytes calldata data,
        uint256 offset
    ) external pure returns (uint64 value, uint256 newOffset) {
        return BorshLib.readU64(data, offset);
    }

    function readU128(
        bytes calldata data,
        uint256 offset
    ) external pure returns (uint128 value, uint256 newOffset) {
        return BorshLib.readU128(data, offset);
    }

    function readI8(
        bytes calldata data,
        uint256 offset
    ) external pure returns (int8 value, uint256 newOffset) {
        return BorshLib.readI8(data, offset);
    }

    function readI16(
        bytes calldata data,
        uint256 offset
    ) external pure returns (int16 value, uint256 newOffset) {
        return BorshLib.readI16(data, offset);
    }

    function readI32(
        bytes calldata data,
        uint256 offset
    ) external pure returns (int32 value, uint256 newOffset) {
        return BorshLib.readI32(data, offset);
    }

    function readI64(
        bytes calldata data,
        uint256 offset
    ) external pure returns (int64 value, uint256 newOffset) {
        return BorshLib.readI64(data, offset);
    }

    function readI128(
        bytes calldata data,
        uint256 offset
    ) external pure returns (int128 value, uint256 newOffset) {
        return BorshLib.readI128(data, offset);
    }

    function readBool(
        bytes calldata data,
        uint256 offset
    ) external pure returns (bool value, uint256 newOffset) {
        return BorshLib.readBool(data, offset);
    }

    function readBytes32(
        bytes calldata data,
        uint256 offset
    ) external pure returns (bytes32 value, uint256 newOffset) {
        return BorshLib.readBytes32(data, offset);
    }

    function readBytes(
        bytes calldata data,
        uint256 offset,
        uint256 n
    ) external pure returns (bytes calldata value, uint256 newOffset) {
        return BorshLib.readBytes(data, offset, n);
    }

    function readString(
        bytes calldata data,
        uint256 offset
    ) external pure returns (string calldata value, uint256 newOffset) {
        return BorshLib.readString(data, offset);
    }

    function readVecLen(
        bytes calldata data,
        uint256 offset
    ) external pure returns (uint32 count, uint256 newOffset) {
        return BorshLib.readVecLen(data, offset);
    }
}

contract BorshLibTest is Test {
    BorshHarness lib;

    function setUp() external {
        lib = new BorshHarness();
    }

    //--- Borsh encoding helpers (little-endian) ---//

    function _encodeU8(uint8 value) internal pure returns (bytes memory) {
        bytes memory b = new bytes(1);
        b[0] = bytes1(value);
        return b;
    }

    function _encodeU16(uint16 value) internal pure returns (bytes memory) {
        bytes memory b = new bytes(2);
        b[0] = bytes1(uint8(value));
        b[1] = bytes1(uint8(value >> 8));
        return b;
    }

    function _encodeU32(uint32 value) internal pure returns (bytes memory) {
        bytes memory b = new bytes(4);
        b[0] = bytes1(uint8(value));
        b[1] = bytes1(uint8(value >> 8));
        b[2] = bytes1(uint8(value >> 16));
        b[3] = bytes1(uint8(value >> 24));
        return b;
    }

    function _encodeU64(uint64 value) internal pure returns (bytes memory) {
        bytes memory b = new bytes(8);
        b[0] = bytes1(uint8(value));
        b[1] = bytes1(uint8(value >> 8));
        b[2] = bytes1(uint8(value >> 16));
        b[3] = bytes1(uint8(value >> 24));
        b[4] = bytes1(uint8(value >> 32));
        b[5] = bytes1(uint8(value >> 40));
        b[6] = bytes1(uint8(value >> 48));
        b[7] = bytes1(uint8(value >> 56));
        return b;
    }

    function _encodeU128(uint128 value) internal pure returns (bytes memory) {
        bytes memory b = new bytes(16);
        b[0] = bytes1(uint8(value));
        b[1] = bytes1(uint8(value >> 8));
        b[2] = bytes1(uint8(value >> 16));
        b[3] = bytes1(uint8(value >> 24));
        b[4] = bytes1(uint8(value >> 32));
        b[5] = bytes1(uint8(value >> 40));
        b[6] = bytes1(uint8(value >> 48));
        b[7] = bytes1(uint8(value >> 56));
        b[8] = bytes1(uint8(value >> 64));
        b[9] = bytes1(uint8(value >> 72));
        b[10] = bytes1(uint8(value >> 80));
        b[11] = bytes1(uint8(value >> 88));
        b[12] = bytes1(uint8(value >> 96));
        b[13] = bytes1(uint8(value >> 104));
        b[14] = bytes1(uint8(value >> 112));
        b[15] = bytes1(uint8(value >> 120));
        return b;
    }

    function _encodeI8(int8 value) internal pure returns (bytes memory) {
        return _encodeU8(uint8(value));
    }

    function _encodeI16(int16 value) internal pure returns (bytes memory) {
        return _encodeU16(uint16(value));
    }

    function _encodeI32(int32 value) internal pure returns (bytes memory) {
        return _encodeU32(uint32(value));
    }

    function _encodeI64(int64 value) internal pure returns (bytes memory) {
        return _encodeU64(uint64(value));
    }

    function _encodeI128(int128 value) internal pure returns (bytes memory) {
        return _encodeU128(uint128(value));
    }

    function _encodeBool(bool value) internal pure returns (bytes memory) {
        bytes memory b = new bytes(1);
        b[0] = value ? bytes1(0x01) : bytes1(0x00);
        return b;
    }

    function _encodeBytes32(
        bytes32 value
    ) internal pure returns (bytes memory) {
        bytes memory b = new bytes(32);
        assembly ("memory-safe") {
            mstore(add(b, 0x20), value)
        }
        return b;
    }

    function _encodeString(
        string memory value
    ) internal pure returns (bytes memory) {
        bytes memory raw = bytes(value);
        uint256 len = raw.length;
        bytes memory b = new bytes(4 + len);
        b[0] = bytes1(uint8(len));
        b[1] = bytes1(uint8(len >> 8));
        b[2] = bytes1(uint8(len >> 16));
        b[3] = bytes1(uint8(len >> 24));
        for (uint256 i = 0; i < len; i++) {
            b[4 + i] = raw[i];
        }
        return b;
    }

    function _concat(
        bytes memory a,
        bytes memory b
    ) internal pure returns (bytes memory) {
        bytes memory result = new bytes(a.length + b.length);
        for (uint256 i = 0; i < a.length; i++) result[i] = a[i];
        for (uint256 i = 0; i < b.length; i++) result[a.length + i] = b[i];
        return result;
    }

    function _call(
        bytes memory cd
    ) internal view returns (bool success, bytes memory ret) {
        (success, ret) = address(lib).staticcall(cd);
    }

    /// @dev Memory wrapper — copies bytes memory to a calldata-sized buffer for testing.
    function _readString(
        bytes memory data,
        uint256 offset
    ) internal pure returns (string memory value, uint256 newOffset) {
        uint32 len;
        uint256 cursor;
        (len, cursor) = _readU32(data, offset);
        unchecked {
            if (cursor + len > data.length) revert BorshLib.BorshUnderflow();
        }
        newOffset = cursor + len;
        value = string(_slice(data, cursor, len));
    }

    function _readU32(
        bytes memory data,
        uint256 offset
    ) internal pure returns (uint32 value, uint256 newOffset) {
        assembly ("memory-safe") {
            let ptr := add(add(data, 0x20), offset)
            let word := mload(ptr)
            value := or(byte(0, word), shl(8, byte(1, word)))
            value := or(value, shl(16, byte(2, word)))
            value := or(value, shl(24, byte(3, word)))
        }
        newOffset = offset + 4;
    }

    function _slice(
        bytes memory data,
        uint256 start,
        uint256 len
    ) internal pure returns (bytes memory) {
        bytes memory result = new bytes(len);
        for (uint256 i = 0; i < len; i++) result[i] = data[start + i];
        return result;
    }

    //--- Unsigned Integers ---//

    function test_readU8_max() external {
        bytes memory data = _encodeU8(type(uint8).max);
        (bool ok, bytes memory ret) = _call(
            abi.encodeWithSelector(BorshHarness.readU8.selector, data, 0)
        );
        (uint8 val, uint256 cur) = abi.decode(ret, (uint8, uint256));
        assertEq(val, type(uint8).max);
        assertEq(cur, 1);
    }

    function test_readU8_offset(uint8 a, uint8 b) external {
        bytes memory data = _concat(_encodeU8(a), _encodeU8(b));
        (bool ok, bytes memory ret) = _call(
            abi.encodeWithSelector(BorshHarness.readU8.selector, data, 1)
        );
        (uint8 val, uint256 cur) = abi.decode(ret, (uint8, uint256));
        assertEq(val, b);
        assertEq(cur, 2);
    }

    function test_readU16_fuzz(uint16 x) external {
        bytes memory data = _encodeU16(x);
        (bool ok, bytes memory ret) = _call(
            abi.encodeWithSelector(BorshHarness.readU16.selector, data, 0)
        );
        (uint16 val, uint256 cur) = abi.decode(ret, (uint16, uint256));
        assertEq(val, x);
        assertEq(cur, 2);
    }

    function test_readU32_fuzz(uint32 x) external {
        bytes memory data = _encodeU32(x);
        (bool ok, bytes memory ret) = _call(
            abi.encodeWithSelector(BorshHarness.readU32.selector, data, 0)
        );
        (uint32 val, uint256 cur) = abi.decode(ret, (uint32, uint256));
        assertEq(val, x);
        assertEq(cur, 4);
    }

    function test_readU64_fuzz(uint64 x) external {
        bytes memory data = _encodeU64(x);
        (bool ok, bytes memory ret) = _call(
            abi.encodeWithSelector(BorshHarness.readU64.selector, data, 0)
        );
        (uint64 val, uint256 cur) = abi.decode(ret, (uint64, uint256));
        assertEq(val, x);
        assertEq(cur, 8);
    }

    function test_readU128_fuzz(uint128 x) external {
        bytes memory data = _encodeU128(x);
        (bool ok, bytes memory ret) = _call(
            abi.encodeWithSelector(BorshHarness.readU128.selector, data, 0)
        );
        (uint128 val, uint256 cur) = abi.decode(ret, (uint128, uint256));
        assertEq(val, x);
        assertEq(cur, 16);
    }

    function test_readU16_offset(uint16 a, uint16 b) external {
        bytes memory data = _concat(_encodeU16(a), _encodeU16(b));
        (bool ok, bytes memory ret) = _call(
            abi.encodeWithSelector(BorshHarness.readU16.selector, data, 2)
        );
        (uint16 val, uint256 cur) = abi.decode(ret, (uint16, uint256));
        assertEq(val, b);
        assertEq(cur, 4);
    }

    function test_readU32_offset(uint32 a, uint32 b) external {
        bytes memory data = _concat(_encodeU32(a), _encodeU32(b));
        (bool ok, bytes memory ret) = _call(
            abi.encodeWithSelector(BorshHarness.readU32.selector, data, 4)
        );
        (uint32 val, uint256 cur) = abi.decode(ret, (uint32, uint256));
        assertEq(val, b);
        assertEq(cur, 8);
    }

    function test_readU64_offset(uint64 a, uint64 b) external {
        bytes memory data = _concat(_encodeU64(a), _encodeU64(b));
        (bool ok, bytes memory ret) = _call(
            abi.encodeWithSelector(BorshHarness.readU64.selector, data, 8)
        );
        (uint64 val, uint256 cur) = abi.decode(ret, (uint64, uint256));
        assertEq(val, b);
        assertEq(cur, 16);
    }

    function test_readU128_offset(uint128 a, uint128 b) external {
        bytes memory data = _concat(_encodeU128(a), _encodeU128(b));
        (bool ok, bytes memory ret) = _call(
            abi.encodeWithSelector(BorshHarness.readU128.selector, data, 16)
        );
        (uint128 val, uint256 cur) = abi.decode(ret, (uint128, uint256));
        assertEq(val, b);
        assertEq(cur, 32);
    }

    //--- Signed Integers ---//

    function test_readI8_negative_one() external {
        bytes memory data = _encodeI8(-1);
        (bool ok, bytes memory ret) = _call(
            abi.encodeWithSelector(BorshHarness.readI8.selector, data, 0)
        );
        (int8 val, uint256 cur) = abi.decode(ret, (int8, uint256));
        assertEq(val, int8(-1));
        assertEq(cur, 1);
    }

    function test_readI8_min_max() external {
        bytes memory data = _encodeI8(type(int8).min);
        (bool ok, bytes memory ret) = _call(
            abi.encodeWithSelector(BorshHarness.readI8.selector, data, 0)
        );
        (int8 val, uint256 cur) = abi.decode(ret, (int8, uint256));
        assertEq(val, type(int8).min);

        data = _encodeI8(type(int8).max);
        (ok, ret) = _call(
            abi.encodeWithSelector(BorshHarness.readI8.selector, data, 0)
        );
        (val, cur) = abi.decode(ret, (int8, uint256));
        assertEq(val, type(int8).max);
    }

    function test_readI16_fuzz(int16 x) external {
        bytes memory data = _encodeI16(x);
        (bool ok, bytes memory ret) = _call(
            abi.encodeWithSelector(BorshHarness.readI16.selector, data, 0)
        );
        (int16 val, uint256 cur) = abi.decode(ret, (int16, uint256));
        assertEq(val, x);
        assertEq(cur, 2);
    }

    function test_readI32_fuzz(int32 x) external {
        bytes memory data = _encodeI32(x);
        (bool ok, bytes memory ret) = _call(
            abi.encodeWithSelector(BorshHarness.readI32.selector, data, 0)
        );
        (int32 val, uint256 cur) = abi.decode(ret, (int32, uint256));
        assertEq(val, x);
        assertEq(cur, 4);
    }

    function test_readI64_fuzz(int64 x) external {
        bytes memory data = _encodeI64(x);
        (bool ok, bytes memory ret) = _call(
            abi.encodeWithSelector(BorshHarness.readI64.selector, data, 0)
        );
        (int64 val, uint256 cur) = abi.decode(ret, (int64, uint256));
        assertEq(val, x);
        assertEq(cur, 8);
    }

    function test_readI128_fuzz(int128 x) external {
        bytes memory data = _encodeI128(x);
        (bool ok, bytes memory ret) = _call(
            abi.encodeWithSelector(BorshHarness.readI128.selector, data, 0)
        );
        (int128 val, uint256 cur) = abi.decode(ret, (int128, uint256));
        assertEq(val, x);
        assertEq(cur, 16);
    }

    //--- Bool ---//

    function test_readBool_true() external {
        bytes memory data = _encodeBool(true);
        (bool ok, bytes memory ret) = _call(
            abi.encodeWithSelector(BorshHarness.readBool.selector, data, 0)
        );
        (bool val, uint256 cur) = abi.decode(ret, (bool, uint256));
        assertTrue(val);
        assertEq(cur, 1);
    }

    function test_readBool_false() external {
        bytes memory data = _encodeBool(false);
        (bool ok, bytes memory ret) = _call(
            abi.encodeWithSelector(BorshHarness.readBool.selector, data, 0)
        );
        (bool val, uint256 cur) = abi.decode(ret, (bool, uint256));
        assertTrue(!val);
        assertEq(cur, 1);
    }

    //--- readBytes32 ---//

    function test_readBytes32_fuzz(bytes32 x) external {
        bytes memory data = _encodeBytes32(x);
        (bool ok, bytes memory ret) = _call(
            abi.encodeWithSelector(BorshHarness.readBytes32.selector, data, 0)
        );
        (bytes32 val, uint256 cur) = abi.decode(ret, (bytes32, uint256));
        assertEq(val, x);
        assertEq(cur, 32);
    }

    function test_readBytes32_offset() external {
        bytes32 a = keccak256("a");
        bytes32 b = keccak256("b");
        bytes memory data = _concat(_encodeBytes32(a), _encodeBytes32(b));
        (bool ok, bytes memory ret) = _call(
            abi.encodeWithSelector(BorshHarness.readBytes32.selector, data, 32)
        );
        (bytes32 val, uint256 cur) = abi.decode(ret, (bytes32, uint256));
        assertEq(val, b);
        assertEq(cur, 64);
    }

    //--- readBytes ---//

    function test_readBytes_partial() external {
        bytes memory data = hex"AABBCCDDEEFF";
        (bool ok, bytes memory ret) = _call(
            abi.encodeWithSelector(
                BorshHarness.readBytes.selector,
                data,
                uint256(2),
                uint256(3)
            )
        );
        assertTrue(ok);
        bytes memory raw = abi.decode(ret, (bytes));
        assertEq(raw, hex"CCDDEE");
    }

    function test_readBytes_empty() external {
        bytes memory data = hex"";
        (bool ok, bytes memory ret) = _call(
            abi.encodeWithSelector(
                BorshHarness.readBytes.selector,
                data,
                uint256(0),
                uint256(0)
            )
        );
        assertTrue(ok);
    }

    function test_readBytes_oob() external {
        bytes memory data = hex"AA";
        (bool ok, ) = _call(
            abi.encodeWithSelector(
                BorshHarness.readBytes.selector,
                data,
                uint256(0),
                uint256(3)
            )
        );
        assertTrue(!ok);
    }

    //--- readString ---//

    function test_readString_hello() external {
        bytes memory data = _encodeString("hello");
        assertEq(data.length, 9);
        // u32 LE = 5 at bytes 0-3
        assertEq(uint8(data[0]), 5);
        assertEq(data[4], "h");

        string memory val;
        uint256 cur;
        (val, cur) = _readString(data, 0);
        assertEq(val, "hello");
        assertEq(cur, 9);
    }

    function test_readString_utf8() external {
        string memory val;
        uint256 cur;
        (val, cur) = _readString(_encodeString(unicode"café"), 0);
        assertEq(val, unicode"café");
        assertEq(cur, 9);
    }

    function test_readString_oob() external {
        bytes memory data = _encodeU32(100);
        (bool ok, ) = _call(
            abi.encodeWithSelector(BorshHarness.readString.selector, data, 0)
        );
        assertTrue(!ok);
    }

    function test_readVecLen_fuzz(uint32 x) external {
        bytes memory data = _encodeU32(x);
        (bool ok, bytes memory ret) = _call(
            abi.encodeWithSelector(BorshHarness.readVecLen.selector, data, 0)
        );
        (uint32 val, uint256 cur) = abi.decode(ret, (uint32, uint256));
        assertEq(val, x);
        assertEq(cur, 4);
    }

    function test_sequential_reads() external {
        bytes memory data = _concat(_encodeU8(42), _encodeU16(1000));
        data = _concat(data, _encodeU32(1000000));
        data = _concat(data, _encodeU64(10000000000));
        data = _concat(data, _encodeBool(true));

        uint256 cur;
        bytes memory ret;
        bool ok;

        (ok, ret) = _call(
            abi.encodeWithSelector(BorshHarness.readU8.selector, data, 0)
        );
        assertTrue(ok);
        uint8 a;
        (a, cur) = abi.decode(ret, (uint8, uint256));
        assertEq(a, 42);

        (ok, ret) = _call(
            abi.encodeWithSelector(BorshHarness.readU16.selector, data, cur)
        );
        assertTrue(ok);
        uint16 b;
        (b, cur) = abi.decode(ret, (uint16, uint256));
        assertEq(b, 1000);

        (ok, ret) = _call(
            abi.encodeWithSelector(BorshHarness.readU32.selector, data, cur)
        );
        assertTrue(ok);
        uint32 c;
        (c, cur) = abi.decode(ret, (uint32, uint256));
        assertEq(c, 1000000);

        (ok, ret) = _call(
            abi.encodeWithSelector(BorshHarness.readU64.selector, data, cur)
        );
        assertTrue(ok);
        uint64 d;
        (d, cur) = abi.decode(ret, (uint64, uint256));
        assertEq(d, 10000000000);

        (ok, ret) = _call(
            abi.encodeWithSelector(BorshHarness.readBool.selector, data, cur)
        );
        assertTrue(ok);
        bool e;
        (e, cur) = abi.decode(ret, (bool, uint256));
        assertTrue(e);
        assertEq(cur, data.length);
    }

    function test_struct_with_string_and_vec() external {
        bytes memory data = _encodeString("test");
        data = _concat(data, _encodeU32(3));
        data = _concat(data, _encodeU64(10));
        data = _concat(data, _encodeU64(20));
        data = _concat(data, _encodeU64(30));

        uint256 cur;
        bool ok;
        bytes memory ret;

        string memory name;
        (name, cur) = _readString(data, 0);
        assertEq(name, "test");

        (ok, ret) = _call(
            abi.encodeWithSelector(BorshHarness.readVecLen.selector, data, cur)
        );
        assertTrue(ok);
        uint32 vecLen;
        (vecLen, cur) = abi.decode(ret, (uint32, uint256));
        assertEq(vecLen, 3);

        (ok, ret) = _call(
            abi.encodeWithSelector(BorshHarness.readU64.selector, data, cur)
        );
        assertTrue(ok);
        uint64 item0;
        (item0, cur) = abi.decode(ret, (uint64, uint256));
        assertEq(item0, 10);

        (ok, ret) = _call(
            abi.encodeWithSelector(BorshHarness.readU64.selector, data, cur)
        );
        assertTrue(ok);
        uint64 item1;
        (item1, cur) = abi.decode(ret, (uint64, uint256));
        assertEq(item1, 20);

        (ok, ret) = _call(
            abi.encodeWithSelector(BorshHarness.readU64.selector, data, cur)
        );
        assertTrue(ok);
        uint64 item2;
        (item2, cur) = abi.decode(ret, (uint64, uint256));
        assertEq(item2, 30);
        assertEq(cur, data.length);
    }

    function test_readU64_powers_of_two(uint8 shift) external {
        vm.assume(shift < 64);
        uint64 x = uint64(1) << shift;
        bytes memory data = _encodeU64(x);
        (bool ok, bytes memory ret) = _call(
            abi.encodeWithSelector(BorshHarness.readU64.selector, data, 0)
        );
        (uint64 val, uint256 cur) = abi.decode(ret, (uint64, uint256));
        assertEq(val, x);
        assertEq(cur, 8);
    }

    function test_readU128_powers_of_two(uint8 shift) external {
        vm.assume(shift < 128);
        uint128 x = uint128(1) << shift;
        bytes memory data = _encodeU128(x);
        (bool ok, bytes memory ret) = _call(
            abi.encodeWithSelector(BorshHarness.readU128.selector, data, 0)
        );
        (uint128 val, uint256 cur) = abi.decode(ret, (uint128, uint256));
        assertEq(val, x);
        assertEq(cur, 16);
    }

    function test_u16_max() external {
        bytes memory data = _encodeU16(type(uint16).max);
        (bool ok, bytes memory ret) = _call(
            abi.encodeWithSelector(BorshHarness.readU16.selector, data, 0)
        );
        (uint16 val, uint256 cur) = abi.decode(ret, (uint16, uint256));
        assertEq(val, type(uint16).max);
        assertEq(cur, 2);
    }

    function test_u32_max() external {
        bytes memory data = _encodeU32(type(uint32).max);
        (bool ok, bytes memory ret) = _call(
            abi.encodeWithSelector(BorshHarness.readU32.selector, data, 0)
        );
        (uint32 val, uint256 cur) = abi.decode(ret, (uint32, uint256));
        assertEq(val, type(uint32).max);
        assertEq(cur, 4);
    }

    function test_u64_max() external {
        bytes memory data = _encodeU64(type(uint64).max);
        (bool ok, bytes memory ret) = _call(
            abi.encodeWithSelector(BorshHarness.readU64.selector, data, 0)
        );
        (uint64 val, uint256 cur) = abi.decode(ret, (uint64, uint256));
        assertEq(val, type(uint64).max);
        assertEq(cur, 8);
    }

    function test_u128_max() external {
        bytes memory data = _encodeU128(type(uint128).max);
        (bool ok, bytes memory ret) = _call(
            abi.encodeWithSelector(BorshHarness.readU128.selector, data, 0)
        );
        (uint128 val, uint256 cur) = abi.decode(ret, (uint128, uint256));
        assertEq(val, type(uint128).max);
        assertEq(cur, 16);
    }
}
