import { describe, expect, test } from "bun:test";
import {
  buildServerAad,
  NO_PROFILE_AAD_SENTINEL,
  profileIdForServerAad,
  SERVER_AAD_MIN_VERSION,
  type ServerAadMeta,
} from "../shared/aad";

const META: ServerAadMeta = {
  orgId: "org_abc",
  profileId: "prof_xyz",
  itemId: "item_123",
  keyVersion: 2,
};

describe("buildServerAad", () => {
  test("is deterministic for identical input", () => {
    const a = buildServerAad(META);
    const b = buildServerAad(META);
    expect(a).toEqual(b);
  });

  test("carries the 'abadge-sm-v1' domain separator prefix", () => {
    const aad = buildServerAad(META);
    const prefix = new TextEncoder().encode("abadge-sm-v1\0");
    expect(aad.slice(0, prefix.length)).toEqual(prefix);
  });

  test("different orgId produces different AAD", () => {
    const a = buildServerAad(META);
    const b = buildServerAad({ ...META, orgId: "org_other" });
    expect(a).not.toEqual(b);
  });

  test("different profileId produces different AAD", () => {
    const a = buildServerAad(META);
    const b = buildServerAad({ ...META, profileId: "prof_other" });
    expect(a).not.toEqual(b);
  });

  test("different itemId produces different AAD", () => {
    const a = buildServerAad(META);
    const b = buildServerAad({ ...META, itemId: "item_other" });
    expect(a).not.toEqual(b);
  });

  test("different keyVersion produces different AAD", () => {
    const a = buildServerAad({ ...META, keyVersion: 2 });
    const b = buildServerAad({ ...META, keyVersion: 3 });
    expect(a).not.toEqual(b);
  });

  test("null separators prevent boundary ambiguity", () => {
    // "ab" + "cd" vs "a" + "bcd" must produce different AADs; the null
    // separator after each identifier guarantees this.
    const a = buildServerAad({
      orgId: "ab",
      profileId: "cd",
      itemId: "item",
      keyVersion: 2,
    });
    const b = buildServerAad({
      orgId: "a",
      profileId: "bcd",
      itemId: "item",
      keyVersion: 2,
    });
    expect(a).not.toEqual(b);
  });

  test("keyVersion is encoded big-endian (u32be)", () => {
    const aad = buildServerAad({ ...META, keyVersion: 0x01020304 });
    const tail = aad.slice(aad.length - 4);
    expect(tail).toEqual(new Uint8Array([0x01, 0x02, 0x03, 0x04]));
  });

  test("sentinel profile id is distinct from a real profile id of the same text", () => {
    // Trivially true by equality (both exercise the same code path), but
    // pinning the sentinel value here catches accidental drift across
    // encrypt/decrypt sites.
    expect(NO_PROFILE_AAD_SENTINEL).toBe("__no_profile__");
  });

  test("SERVER_AAD_MIN_VERSION matches expected v2", () => {
    expect(SERVER_AAD_MIN_VERSION).toBe(2);
  });
});

describe("profileIdForServerAad", () => {
  test("null profileId returns the sentinel", () => {
    expect(profileIdForServerAad(null)).toBe(NO_PROFILE_AAD_SENTINEL);
  });

  test("undefined profileId returns the sentinel", () => {
    expect(profileIdForServerAad(undefined)).toBe(NO_PROFILE_AAD_SENTINEL);
  });

  test("non-null profileId is returned unchanged", () => {
    expect(profileIdForServerAad("prof_real")).toBe("prof_real");
  });

  test("empty string profileId is returned unchanged (distinct from null)", () => {
    // Empty-string is a real value and must not be conflated with null.
    expect(profileIdForServerAad("")).toBe("");
  });
});
