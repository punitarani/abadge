import { describe, expect, test } from "bun:test";
import { parseInviteToken } from "./parse-invite-token";

describe("parseInviteToken", () => {
  test("returns a bare token unchanged", () => {
    expect(parseInviteToken("abi_abcdef1234567890")).toBe("abi_abcdef1234567890");
  });

  test("trims surrounding whitespace", () => {
    expect(parseInviteToken("   abi_abc   ")).toBe("abi_abc");
  });

  test("extracts the token from a full HTTPS invite URL", () => {
    expect(parseInviteToken("https://app.abadge.io/invite/accept?token=abi_abcdef1234")).toBe(
      "abi_abcdef1234",
    );
  });

  test("extracts the token from a /join URL with extra params", () => {
    expect(parseInviteToken("https://app.abadge.io/join?token=abi_xyz&ref=slack")).toBe("abi_xyz");
  });

  test("extracts the token from a scheme-less path", () => {
    expect(parseInviteToken("/invite/accept?token=abi_scheme_less")).toBe("abi_scheme_less");
  });

  test("returns null when the URL has no token query param", () => {
    expect(parseInviteToken("https://app.abadge.io/login")).toBeNull();
  });

  test("returns null when the token query param has the wrong prefix", () => {
    expect(parseInviteToken("https://app.abadge.io/join?token=nope_1234")).toBeNull();
  });

  test("returns null for empty input", () => {
    expect(parseInviteToken("")).toBeNull();
    expect(parseInviteToken("   ")).toBeNull();
  });

  test("returns null for a bare string that isn't a token", () => {
    expect(parseInviteToken("just some text")).toBeNull();
  });
});
