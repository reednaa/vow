use anchor_lang::prelude::*;

use crate::errors::VowError;

pub fn read_u8(data: &[u8], offset: usize) -> Result<(u8, usize)> {
    let (bytes, new_offset) = read_bytes(data, offset, 1)?;
    Ok((bytes[0], new_offset))
}

pub fn read_u16(data: &[u8], offset: usize) -> Result<(u16, usize)> {
    let (bytes, new_offset) = read_bytes(data, offset, 2)?;
    Ok((u16::from_le_bytes([bytes[0], bytes[1]]), new_offset))
}

pub fn read_u32(data: &[u8], offset: usize) -> Result<(u32, usize)> {
    let (bytes, new_offset) = read_bytes(data, offset, 4)?;
    Ok((
        u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
        new_offset,
    ))
}

pub fn read_u64(data: &[u8], offset: usize) -> Result<(u64, usize)> {
    let (bytes, new_offset) = read_bytes(data, offset, 8)?;
    Ok((
        u64::from_le_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        ]),
        new_offset,
    ))
}

pub fn read_u128(data: &[u8], offset: usize) -> Result<(u128, usize)> {
    let (bytes, new_offset) = read_bytes(data, offset, 16)?;
    Ok((
        u128::from_le_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
            bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15],
        ]),
        new_offset,
    ))
}

pub fn read_i8(data: &[u8], offset: usize) -> Result<(i8, usize)> {
    let (value, new_offset) = read_u8(data, offset)?;
    Ok((value as i8, new_offset))
}

pub fn read_i16(data: &[u8], offset: usize) -> Result<(i16, usize)> {
    let (bytes, new_offset) = read_bytes(data, offset, 2)?;
    Ok((i16::from_le_bytes([bytes[0], bytes[1]]), new_offset))
}

pub fn read_i32(data: &[u8], offset: usize) -> Result<(i32, usize)> {
    let (bytes, new_offset) = read_bytes(data, offset, 4)?;
    Ok((
        i32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
        new_offset,
    ))
}

pub fn read_i64(data: &[u8], offset: usize) -> Result<(i64, usize)> {
    let (bytes, new_offset) = read_bytes(data, offset, 8)?;
    Ok((
        i64::from_le_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        ]),
        new_offset,
    ))
}

pub fn read_i128(data: &[u8], offset: usize) -> Result<(i128, usize)> {
    let (bytes, new_offset) = read_bytes(data, offset, 16)?;
    Ok((
        i128::from_le_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
            bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15],
        ]),
        new_offset,
    ))
}

pub fn read_bool(data: &[u8], offset: usize) -> Result<(bool, usize)> {
    let (value, new_offset) = read_u8(data, offset)?;
    Ok((value == 1, new_offset))
}

pub fn read_bytes32(data: &[u8], offset: usize) -> Result<([u8; 32], usize)> {
    let (bytes, new_offset) = read_bytes(data, offset, 32)?;
    let mut value = [0u8; 32];
    value.copy_from_slice(bytes);
    Ok((value, new_offset))
}

pub fn read_bytes<'a>(data: &'a [u8], offset: usize, n: usize) -> Result<(&'a [u8], usize)> {
    let end = offset
        .checked_add(n)
        .ok_or(error!(VowError::BorshUnderflow))?;
    if end > data.len() {
        return Err(error!(VowError::BorshUnderflow));
    }
    Ok((&data[offset..end], end))
}

pub fn read_string<'a>(data: &'a [u8], offset: usize) -> Result<(&'a str, usize)> {
    let (len, cursor) = read_u32(data, offset)?;
    let (bytes, new_offset) = read_bytes(data, cursor, len as usize)?;
    let value = core::str::from_utf8(bytes).map_err(|_| error!(VowError::InvalidUtf8))?;
    Ok((value, new_offset))
}

pub fn read_vec_len(data: &[u8], offset: usize) -> Result<(u32, usize)> {
    read_u32(data, offset)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_unsigned_integers() {
        let bytes = [
            0x2a, 0x34, 0x12, 0x78, 0x56, 0x34, 0x12, 0xef, 0xcd, 0xab, 0x90, 0x78, 0x56, 0x34,
            0x12,
        ];

        let (u8_value, offset) = read_u8(&bytes, 0).unwrap();
        assert_eq!(u8_value, 0x2a);

        let (u16_value, offset) = read_u16(&bytes, offset).unwrap();
        assert_eq!(u16_value, 0x1234);

        let (u32_value, offset) = read_u32(&bytes, offset).unwrap();
        assert_eq!(u32_value, 0x12345678);

        let (u64_value, offset) = read_u64(&bytes, offset).unwrap();
        assert_eq!(u64_value, 0x1234567890abcdef);
        assert_eq!(offset, bytes.len());
    }

    #[test]
    fn reads_signed_types_and_bool() {
        let bytes = [0xfe, 0xfe, 0xff, 0xff, 0xff, 0xff, 0x7f, 0x01, 0x00];

        let (i8_value, offset) = read_i8(&bytes, 0).unwrap();
        assert_eq!(i8_value, -2);

        let (i16_value, offset) = read_i16(&bytes, offset).unwrap();
        assert_eq!(i16_value, -2);

        let (i32_value, offset) = read_i32(&bytes, offset).unwrap();
        assert_eq!(i32_value, i32::MAX);

        let (bool_true, offset) = read_bool(&bytes, offset).unwrap();
        assert!(bool_true);

        let (bool_false, _) = read_bool(&bytes, offset).unwrap();
        assert!(!bool_false);
    }

    #[test]
    fn reads_strings_and_slices() {
        let bytes = [
            0x05, 0x00, 0x00, 0x00, b'h', b'e', b'l', b'l', b'o', 0xaa, 0xbb,
        ];

        let (value, offset) = read_string(&bytes, 0).unwrap();
        assert_eq!(value, "hello");

        let (tail, offset) = read_bytes(&bytes, offset, 2).unwrap();
        assert_eq!(tail, &[0xaa, 0xbb]);
        assert_eq!(offset, bytes.len());
    }
}
