use tiny_keccak::{Hasher, Keccak};

pub fn keccak256(data: &[u8]) -> [u8; 32] {
    let mut keccak = Keccak::v256();
    let mut output = [0u8; 32];
    keccak.update(data);
    keccak.finalize(&mut output);
    output
}

pub fn keccak256_chain(inputs: &[&[u8]]) -> [u8; 32] {
    let mut keccak = Keccak::v256();
    let mut output = [0u8; 32];
    for input in inputs {
        keccak.update(input);
    }
    keccak.finalize(&mut output);
    output
}

pub fn vow_type_hash_bytes() -> [u8; 32] {
    keccak256(b"Vow(uint256 chainId,uint256 rootBlockNumber,bytes32 root)")
}

pub fn bare_eip712_domain_typehash() -> [u8; 32] {
    keccak256(b"EIP712Domain()")
}
