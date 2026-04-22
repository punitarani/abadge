# Crypto Tester Prompt

Test one cell of `packages/crypto`. Static + property-based testing.

## Context

- Client-side ZK: Argon2id KDF, XChaCha20-Poly1305 wrap + content encryption (`@noble/ciphers`, `@noble/hashes`).
- Server-side: AES-256-GCM via WebCrypto.
- Identity: Ed25519 keypairs, API-key SHA-256 with constant-time compare.
- Tokens: opaque random with prefixes (`abe_`, `abc_`, `abs_`, `abi_`).
- Encodings: base64url, base32 (Crockford?).

## What to probe

**happy**: round-trip encrypt/decrypt; sign/verify; encode/decode.

**adversarial**:
- nonce reuse: force two encrypts with the same nonce → distinguishable ciphertexts? (should never happen but verify gen)
- KDF param tampering: pass `memory: 1` → does the KDF accept (§SEC11)?
- API-key compare: timing variance with known-correct vs known-wrong-near-end inputs
- ciphertext bit-flip: mutate a byte, verify decrypt fails with auth error

**edge**: empty plaintext, max-size plaintext, base64url with padding/no-padding, base32 case sensitivity.

## Useful

```bash
bun test packages/crypto                   # full suite
bun test packages/crypto/src/__tests__/server-crypto.test.ts
```

End with the JSON contract.
