# Borsh Encoding & Decoding

> Reference for how Borsh serialization works and how to decode Borsh-encoded byte buffers.
> Borsh = **B**inary **O**bject **R**epresentation **S**erializer for **H**ashing.
> Used by Anchor (Solana) for instruction data, account data, and event payloads.

---

## 1. Core Principles

- **Deterministic** — same data always produces the same bytes (critical for hashing)
- **No schema in the wire format** — you must know the schema to decode
- **Little-endian** — all multi-byte integers are little-endian
- **No length prefixes on top-level structs** — struct fields are packed sequentially

---

## 2. Primitive Type Encoding

| Type | Encoding | Byte Size |
|------|----------|-----------|
| `bool` | `0x00` = false, `0x01` = true | 1 |
| `u8` / `i8` | Raw byte | 1 |
| `u16` / `i16` | Little-endian | 2 |
| `u32` / `i32` | Little-endian | 4 |
| `u64` / `i64` | Little-endian | 8 |
| `u128` / `i128` | Little-endian | 16 |
| `f32` | IEEE 754 little-endian | 4 |
| `f64` | IEEE 754 little-endian | 8 |

### Examples

```
u32: 42        → 0x2a 0x00 0x00 0x00
u64: 1000000   → 0x40 0x42 0x0f 0x00 0x00 0x00 0x00 0x00
bool: true     → 0x01
bool: false    → 0x00
```

---

## 3. Compound Type Encoding

### 3.1 Fixed-Size Arrays `[T; N]`

Elements packed sequentially with no length prefix. Total size = `N × sizeof(T)`.

```
[u8; 3] = [0xaa, 0xbb, 0xcc]
Encoded: aa bb cc
```

### 3.2 Dynamic Arrays / Vectors `Vec<T>`

A `u32` length prefix (number of elements), followed by sequentially packed elements.

```
Vec<u8> = [0x01, 0x02, 0x03]
Encoded: 03 00 00 00  01 02 03
         ^-- 3 items    ^-- element data
```

### 3.3 Strings `String`

A `u32` byte-length prefix, followed by UTF-8 bytes. **No null terminator.**

```
String = "hello"
Encoded: 05 00 00 00  68 65 6c 6c 6f
         ^-- 5 bytes    ^-- "hello" UTF-8
```

Empty string: `00 00 00 00` (length = 0, no data bytes).

### 3.4 Option `Option<T>`

1-byte tag followed by the value (if present):

```
Option::None    → 0x00  (1 byte, no data)
Option::Some(T) → 0x01  followed by T's encoding
```

```
Option<u32> = Some(42)
Encoded: 01  2a 00 00 00

Option<u32> = None
Encoded: 00
```

### 3.5 Structs

Fields are packed in declaration order with no separators or length prefix.

```rust
struct Transfer {
    amount: u64,
    to: [u8; 32],
}
```

```
Transfer { amount: 100, to: [0x11; 32] }
Encoded: 64 00 00 00 00 00 00 00  11 11 11 ... 11
         ^-- u64 LE amount          ^-- 32 bytes
```

### 3.6 Enums

A `u8` variant index, followed by the variant's data (if any). Variants are numbered 0, 1, 2... in declaration order.

```rust
enum Status {
    Pending,          // variant 0
    Active { x: u32 }, // variant 1
    Done,              // variant 2
}
```

```
Status::Pending       → 00
Status::Active(42)   → 01  2a 00 00 00
Status::Done          → 02
```

### 3.7 HashMap / BTreeMap `Map<K, V>`

A `u32` count of entries, followed by `(key, value)` pairs packed sequentially.

**Keys are NOT guaranteed sorted** in Borsh (sorting is BTreeMap's in-memory property, not part of the wire format).

```
HashMap<u8, String> = { 1 => "ab", 2 => "cd" }
Encoded: 02 00 00 00  01  02 00 00 00  61 62  02  02 00 00 00  63 64
         ^-- 2 entries  ^k1 ^-- "ab" len=2  ^"ab" ^k2 ^-- "cd" len=2  ^"cd"
```

---

## 4. Decoding Algorithm

Given a known schema and a byte buffer:

```
offset = 0

fn read_u8(buf)       → buf[offset++],         return u8
fn read_u16(buf)      → LE from buf[offset..offset+2], offset += 2, return u16
fn read_u32(buf)      → LE from buf[offset..offset+4], offset += 4, return u32
fn read_u64(buf)      → LE from buf[offset..offset+8], offset += 8, return u64
fn read_bool(buf)     → byte = read_u8(buf),   assert byte ∈ {0,1}, return byte == 1
fn read_fixed_array(buf, N, read_elem_fn) → N sequential reads
fn read_vec(buf, read_elem_fn) → count = read_u32(buf), then count × read_elem_fn()
fn read_string(buf)   → len = read_u32(buf), bytes = buf[offset..offset+len], offset += len, return UTF-8 string
fn read_option(buf, read_elem_fn) → tag = read_u8(buf); if tag == 0: return None; return Some(read_elem_fn())
fn read_struct(buf, fields) → for each field: field.value = read_field(buf, field.type)
fn read_enum(buf, variants) → tag = read_u8(buf); read variant[tag]'s associated data
```

### TypeScript Decoder Sketch

```typescript
class BorshDecoder {
  private offset = 0;

  constructor(private buf: Uint8Array) {}

  readU8(): number {
    return this.buf[this.offset++];
  }

  readU16(): number {
    const v = new DataView(this.buf.buffer, this.offset, 2).getUint16(0, true);
    this.offset += 2;
    return v;
  }

  readU32(): number {
    const v = new DataView(this.buf.buffer, this.offset, 4).getUint32(0, true);
    this.offset += 4;
    return v;
  }

  readU64(): bigint {
    const v = new DataView(this.buf.buffer, this.offset, 8).getBigUint64(0, true);
    this.offset += 8;
    return v;
  }

  readBool(): boolean {
    const b = this.readU8();
    if (b > 1) throw new Error(`Invalid bool byte: ${b}`);
    return b === 1;
  }

  readFixedArray<T>(n: number, readElem: () => T): T[] {
    return Array.from({ length: n }, () => readElem());
  }

  readVec<T>(readElem: () => T): T[] {
    const len = this.readU32();
    return Array.from({ length: len }, () => readElem());
  }

  readString(): string {
    const len = this.readU32();
    const bytes = this.buf.slice(this.offset, this.offset + len);
    this.offset += len;
    return new TextDecoder().decode(bytes);
  }

  readOption<T>(readElem: () => T): T | null {
    const tag = this.readU8();
    if (tag === 0) return null;
    if (tag === 1) return readElem();
    throw new Error(`Invalid option tag: ${tag}`);
  }

  readPubkey(): Uint8Array {
    return this.buf.slice(this.offset, (this.offset += 32));
  }

  remaining(): number {
    return this.buf.length - this.offset;
  }
}
```

Usage:

```typescript
// Schema: struct Transfer { amount: u64, to: Pubkey }
function decodeTransfer(buf: Uint8Array) {
  const d = new BorshDecoder(buf);
  return {
    amount: d.readU64(),
    to: d.readPubkey(),
  };
}
```

---

## 5. Anchor Event Encoding

Anchor (the dominant Solana framework) uses Borsh for events. When an Anchor program emits an event via `emit_cpi!()`:

```
Instruction data layout:
[EVENT_IX_TAG: 8 bytes] [event_discriminator: 8 bytes] [borsh event payload: N bytes]

EVENT_IX_TAG      = sha256("anchor:event")[0..8]  → always 0xe445a52e51cb9a1d
event_discriminator = sha256("event:EventName")[0..8]  → unique per event type
```

To decode the event payload, skip the first 16 bytes (tag + discriminator), then decode the remaining bytes according to the event's Borsh schema.

### Example

Event definition (Anchor/Rust):

```rust
#[event]
pub struct TokenSwap {
    pub user: Pubkey,        // [u8; 32]
    pub amount_in: u64,      // u64 LE
    pub amount_out: u64,     // u64 LE
    pub fee: u64,            // u64 LE
}
```

Decoding in TypeScript:

```typescript
function decodeTokenSwap(ixData: Uint8Array) {
  // Skip EVENT_IX_TAG (8) + discriminator (8)
  const d = new BorshDecoder(ixData.slice(16));
  return {
    user: d.readPubkey(),      // 32 bytes
    amountIn: d.readU64(),     // 8 bytes
    amountOut: d.readU64(),    // 8 bytes
    fee: d.readU64(),          // 8 bytes
  };
}
```

Byte layout:

```
Offset  Size  Field
0       8     EVENT_IX_TAG        (e4 45 a5 2e 51 cb 9a 1d)
8       8     event_discriminator  (sha256("event:TokenSwap")[0..8])
16      32    user                (pubkey bytes)
48      8     amount_in           (u64 LE)
56      8     amount_out          (u64 LE)
64      8     fee                 (u64 LE)
Total:  72 bytes
```

---

## 6. Common Pitfalls

1. **Borsh ≠ bincode ≠ MessagePack** — Borsh is a distinct format. Don't mix libraries.

2. **No schema in data** — you can't introspect Borsh bytes. The decoder must know types, field names, and field order exactly.

3. **Vec/String length is element count (or byte count), not byte length of encoded data** — a `Vec<u64>` of 3 elements has prefix 3, followed by 24 bytes, not 3 followed by 24.

4. **Option is a single byte tag, not a length prefix** — `None` is `0x00` (1 byte), `Some(value)` is `0x01` + value bytes.

5. **Enum variants are u8 (0–255), not usize** — if you have >256 variants you have a different problem.

6. **No field alignment/padding** — fields are packed tightly. A `u8` followed by `u64` occupies exactly 9 bytes, not 16.

7. **String is UTF-8 bytes, not characters** — `"café"` is 5 bytes (é = 2 bytes in UTF-8), length prefix is 5.

---

## 7. Relation to the Vow Witness Service

In the Solana witness, we treat Borsh event data as **opaque canonical payload**. The witness service:

1. Extracts the full instruction data (base58-decoded from RPC JSON)
2. Strips EVENT_IX_TAG (8 bytes) to verify it's an Anchor event
3. Constructs canonical encoding: `programId(32B) | discriminator(8B) | remaining_borsh_data(NB)`
4. Hashes and inserts into the Merkle tree

The witness does **not decode** individual event fields — it only needs the canonical bytes for hashing. Consumers who verify proofs decode the `borsh_event_data` portion using the approach described in sections 4–5.

---

## References

- [Borsh specification (NEAR Protocol)](https://borsh.io/)
- [Anchor events documentation](https://www.anchor-lang.com/docs/events)
- [borsh-js (npm)](https://www.npmjs.com/package/borsh) — official JS library
- [borsh-ts (npm)](https://www.npmjs.com/package/@coral-xyz/borsh) — Coral/Anchor's TypeScript Borsh library
