// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

/**
 * @title BorshLib
 * @notice Decodes Borsh-encoded calldata byte buffers on-chain.
 *
 * Borsh = Binary Object Representation Serializer for Hashing.
 * Used by Anchor (Solana) for instruction data, account data, and event payloads.
 *
 * # Key properties
 * - Deterministic — same data always produces the same bytes.
 * - No schema in wire format — caller must know the exact field types and order.
 * - All integers are little-endian.
 * - Struct fields are packed sequentially with no separators or length prefix.
 *
 * # Usage
 * ```solidity
 * (uint64 amount, cursor) = BorshLib.readU64(data, cursor);
 * (bytes32 pubkey, cursor) = BorshLib.readPubkey(data, cursor);
 * (string calldata name, cursor) = BorshLib.readString(data, cursor);
 * ```
 *
 * # Solana witness integration
 * In the Vow witness service, canonical event bytes are:
 *   programId(32B) | discriminator(8B) | borshData(NB)
 *
 * To decode the borsh payload, skip the header by starting at offset 40:
 * ```solidity
 * uint256 cursor = 40;
 * (uint64 amount, cursor) = BorshLib.readU64(data, cursor);
 * ```
 *
 * @author Alexander (reednaa.eth)
 */
library BorshLib {
    error BorshUnderflow();

    //--- Unsigned Integers (Little-Endian) ---//

    function readU8(
        bytes calldata data,
        uint256 offset
    ) internal pure returns (uint8 value, uint256 newOffset) {
        assembly ("memory-safe") {
            value := byte(0, calldataload(add(data.offset, offset)))
            newOffset := add(offset, 1)
        }
    }

    function readU16(
        bytes calldata data,
        uint256 offset
    ) internal pure returns (uint16 value, uint256 newOffset) {
        assembly ("memory-safe") {
            let word := calldataload(add(data.offset, offset))
            value := or(byte(0, word), shl(8, byte(1, word)))
            newOffset := add(offset, 2)
        }
    }

    function readU32(
        bytes calldata data,
        uint256 offset
    ) internal pure returns (uint32 value, uint256 newOffset) {
        assembly ("memory-safe") {
            let word := calldataload(add(data.offset, offset))
            value := or(byte(0, word), shl(8, byte(1, word)))
            value := or(value, shl(16, byte(2, word)))
            value := or(value, shl(24, byte(3, word)))
            newOffset := add(offset, 4)
        }
    }

    function readU64(
        bytes calldata data,
        uint256 offset
    ) internal pure returns (uint64 value, uint256 newOffset) {
        assembly ("memory-safe") {
            let word := calldataload(add(data.offset, offset))
            value := or(byte(0, word), shl(8, byte(1, word)))
            value := or(value, shl(16, byte(2, word)))
            value := or(value, shl(24, byte(3, word)))
            value := or(value, shl(32, byte(4, word)))
            value := or(value, shl(40, byte(5, word)))
            value := or(value, shl(48, byte(6, word)))
            value := or(value, shl(56, byte(7, word)))
            newOffset := add(offset, 8)
        }
    }

    function readU128(
        bytes calldata data,
        uint256 offset
    ) internal pure returns (uint128 value, uint256 newOffset) {
        assembly ("memory-safe") {
            let word := calldataload(add(data.offset, offset))
            value := or(byte(0, word), shl(8, byte(1, word)))
            value := or(value, shl(16, byte(2, word)))
            value := or(value, shl(24, byte(3, word)))
            value := or(value, shl(32, byte(4, word)))
            value := or(value, shl(40, byte(5, word)))
            value := or(value, shl(48, byte(6, word)))
            value := or(value, shl(56, byte(7, word)))
            value := or(value, shl(64, byte(8, word)))
            value := or(value, shl(72, byte(9, word)))
            value := or(value, shl(80, byte(10, word)))
            value := or(value, shl(88, byte(11, word)))
            value := or(value, shl(96, byte(12, word)))
            value := or(value, shl(104, byte(13, word)))
            value := or(value, shl(112, byte(14, word)))
            value := or(value, shl(120, byte(15, word)))
            newOffset := add(offset, 16)
        }
    }

    //--- Signed Integers (Little-Endian) ---//

    function readI8(
        bytes calldata data,
        uint256 offset
    ) internal pure returns (int8 value, uint256 newOffset) {
        uint8 u;
        (u, newOffset) = readU8(data, offset);
        assembly ("memory-safe") {
            value := signextend(0, u)
        }
    }

    function readI16(
        bytes calldata data,
        uint256 offset
    ) internal pure returns (int16 value, uint256 newOffset) {
        uint16 u;
        (u, newOffset) = readU16(data, offset);
        assembly ("memory-safe") {
            value := signextend(1, u)
        }
    }

    function readI32(
        bytes calldata data,
        uint256 offset
    ) internal pure returns (int32 value, uint256 newOffset) {
        uint32 u;
        (u, newOffset) = readU32(data, offset);
        assembly ("memory-safe") {
            value := signextend(3, u)
        }
    }

    function readI64(
        bytes calldata data,
        uint256 offset
    ) internal pure returns (int64 value, uint256 newOffset) {
        uint64 u;
        (u, newOffset) = readU64(data, offset);
        assembly ("memory-safe") {
            value := signextend(7, u)
        }
    }

    function readI128(
        bytes calldata data,
        uint256 offset
    ) internal pure returns (int128 value, uint256 newOffset) {
        uint128 u;
        (u, newOffset) = readU128(data, offset);
        assembly ("memory-safe") {
            value := signextend(15, u)
        }
    }

    //--- Bool ---//

    function readBool(
        bytes calldata data,
        uint256 offset
    ) internal pure returns (bool value, uint256 newOffset) {
        uint8 b;
        (b, newOffset) = readU8(data, offset);
        value = b == 1;
    }

    //--- Fixed-Size Bytes ---//

    function readBytes32(
        bytes calldata data,
        uint256 offset
    ) internal pure returns (bytes32 value, uint256 newOffset) {
        assembly ("memory-safe") {
            value := calldataload(add(data.offset, offset))
            newOffset := add(offset, 32)
        }
    }

    function readBytes(
        bytes calldata data,
        uint256 offset,
        uint256 n
    ) internal pure returns (bytes calldata value, uint256 newOffset) {
        unchecked {
            if (offset + n > data.length) revert BorshUnderflow();
        }
        assembly ("memory-safe") {
            value.offset := add(data.offset, offset)
            value.length := n
            newOffset := add(offset, n)
        }
    }

    //--- Dynamic Types ---//

    function readString(
        bytes calldata data,
        uint256 offset
    ) internal pure returns (string calldata value, uint256 newOffset) {
        uint32 len;
        uint256 cursor;
        (len, cursor) = readU32(data, offset);
        unchecked {
            if (cursor + len > data.length) revert BorshUnderflow();
        }
        newOffset = cursor + len;
        assembly ("memory-safe") {
            value.offset := add(data.offset, cursor)
            value.length := len
        }
    }

    /// @dev Returns the element count of a Borsh vector (u32 prefix).
    function readVecLen(
        bytes calldata data,
        uint256 offset
    ) internal pure returns (uint32 count, uint256 newOffset) {
        return readU32(data, offset);
    }
}
