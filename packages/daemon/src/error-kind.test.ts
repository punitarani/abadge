import { describe, expect, test } from "bun:test";
import { daemonErrorKind } from "./error-kind";
import { RPC_ERRORS } from "./types";

describe("daemonErrorKind", () => {
  test("VAULT_LOCKED rpc error → locked", () => {
    const e = Object.assign(new Error("vault is locked"), { code: RPC_ERRORS.VAULT_LOCKED });
    expect(daemonErrorKind(e)).toBe("locked");
  });
  test("AUTH_REQUIRED rpc error → auth", () => {
    const e = Object.assign(new Error("not logged in"), { code: RPC_ERRORS.AUTH_REQUIRED });
    expect(daemonErrorKind(e)).toBe("auth");
  });
  test("connection failure message → unreachable", () => {
    expect(daemonErrorKind(new Error("Cannot connect to vaultd: ENOENT"))).toBe("unreachable");
  });
  test("a decrypt/AAD failure with no rpc code → other", () => {
    expect(daemonErrorKind(new Error("decryption failed: bad AAD"))).toBe("other");
  });
  test("non-error inputs → other", () => {
    expect(daemonErrorKind(null)).toBe("other");
    expect(daemonErrorKind("nope")).toBe("other");
  });
});
