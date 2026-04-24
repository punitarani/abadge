import { describe, expect, test } from "bun:test";
import {
  formatRecoveryKey,
  fromBase32,
  fromBase64,
  generateSalt,
  toBase32,
  toBase64,
} from "../shared/encoding";

describe("base64url", () => {
  test("round-trip", () => {
    const data = new Uint8Array([0, 1, 2, 255, 128, 64]);
    expect(fromBase64(toBase64(data))).toEqual(data);
  });

  test("empty", () => {
    const data = new Uint8Array(0);
    expect(fromBase64(toBase64(data))).toEqual(data);
  });

  test("no padding characters in output", () => {
    const data = new Uint8Array([1]);
    const encoded = toBase64(data);
    expect(encoded).not.toContain("=");
  });

  test("url-safe characters", () => {
    // Bytes that produce + and / in standard base64
    const data = new Uint8Array([251, 239, 190]);
    const encoded = toBase64(data);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
  });

  // §CRYPTO-EDGE1: String.fromCharCode(...data) spreads the full array into
  // individual args, hitting V8's max-args limit (~64K) for inputs over ~750KB.
  // Chunked iteration fixes this; these tests verify the fix and catch regressions.
  test("toBase64 handles 1MB input without stack overflow (§CRYPTO-EDGE1)", () => {
    const data = new Uint8Array(1_048_576); // 1MB
    for (let i = 0; i < data.length; i++) data[i] = i & 0xff;
    const encoded = toBase64(data); // must not throw RangeError
    expect(encoded.length).toBeGreaterThan(0);
    const decoded = fromBase64(encoded);
    expect(decoded).toEqual(data);
  });

  test("toBase64 round-trips exact 8KB+1 boundary", () => {
    const data = new Uint8Array(8193);
    for (let i = 0; i < data.length; i++) data[i] = (i * 7) & 0xff;
    const encoded = toBase64(data);
    const decoded = fromBase64(encoded);
    expect(decoded).toEqual(data);
  });
});

describe("base32", () => {
  test("round-trip", () => {
    const data = new Uint8Array([0, 1, 2, 255, 128, 64]);
    expect(fromBase32(toBase32(data))).toEqual(data);
  });

  test("32-byte key round-trip", () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    expect(fromBase32(toBase32(key))).toEqual(key);
  });

  test("ignores dashes", () => {
    const data = new Uint8Array([1, 2, 3]);
    const encoded = toBase32(data);
    const withDashes = formatRecoveryKey(encoded);
    expect(fromBase32(withDashes)).toEqual(data);
  });
});

describe("generateSalt", () => {
  test("returns 16 bytes", () => {
    const salt = generateSalt();
    expect(salt.length).toBe(16);
  });

  test("returns different values", () => {
    const a = generateSalt();
    const b = generateSalt();
    expect(toBase64(a)).not.toBe(toBase64(b));
  });
});
