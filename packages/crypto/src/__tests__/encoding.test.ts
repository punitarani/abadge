import { describe, expect, test } from "bun:test";
import {
  formatRecoveryKey,
  fromBase32,
  fromBase64,
  generateSalt,
  toBase32,
  toBase64,
} from "../shared/encoding.js";

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
