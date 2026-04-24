import { describe, expect, it } from "bun:test";
import { decodeServerManagedPayload } from "./item-payload";

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

const ITEM_ID = "item_abc123";

describe("decodeServerManagedPayload", () => {
  it("round-trips login payloads preserving all structured fields", () => {
    const payload = {
      v: 1,
      label: "github creds",
      kind: "login",
      tags: ["shared"],
      fields: { username: "alice", password: "p@ss" },
    };
    const result = decodeServerManagedPayload(ITEM_ID, encode(payload));
    expect(result.kind).toBe("login");
    expect(result.label).toBe("github creds");
    expect(result.tags).toEqual(["shared"]);
    expect(result.fields).toEqual({ username: "alice", password: "p@ss" });
  });

  it("round-trips api_key payloads preserving all structured fields", () => {
    const payload = {
      v: 1,
      label: "stripe live",
      kind: "api_key",
      tags: [],
      fields: { key: "sk_live_xyz" },
    };
    const result = decodeServerManagedPayload(ITEM_ID, encode(payload));
    expect(result.kind).toBe("api_key");
    expect(result.label).toBe("stripe live");
    expect(result.tags).toEqual([]);
    expect(result.fields).toEqual({ key: "sk_live_xyz" });
  });

  it("round-trips token payloads preserving all structured fields", () => {
    const payload = {
      v: 1,
      label: "gh pat",
      kind: "token",
      tags: [],
      fields: { token: "ghp_xxx" },
    };
    const result = decodeServerManagedPayload(ITEM_ID, encode(payload));
    expect(result.kind).toBe("token");
    expect(result.label).toBe("gh pat");
    expect(result.tags).toEqual([]);
    expect(result.fields).toEqual({ token: "ghp_xxx" });
  });

  it("round-trips json payloads preserving all structured fields", () => {
    const payload = {
      v: 1,
      label: "kube cfg",
      kind: "json",
      tags: [],
      fields: { data: { nested: "value" } },
    };
    const result = decodeServerManagedPayload(ITEM_ID, encode(payload));
    expect(result.kind).toBe("json");
    expect(result.label).toBe("kube cfg");
    expect(result.tags).toEqual([]);
    expect(result.fields).toEqual({ data: { nested: "value" } });
  });

  it("round-trips certificate payloads preserving all structured fields", () => {
    const payload = {
      v: 1,
      label: "tls cert",
      kind: "certificate",
      tags: [],
      fields: { cert: "-----BEGIN CERTIFICATE-----", key: "-----BEGIN KEY-----" },
    };
    const result = decodeServerManagedPayload(ITEM_ID, encode(payload));
    expect(result.kind).toBe("certificate");
    expect(result.label).toBe("tls cert");
    expect(result.tags).toEqual([]);
    expect(result.fields).toEqual({
      cert: "-----BEGIN CERTIFICATE-----",
      key: "-----BEGIN KEY-----",
    });
  });

  it("round-trips ssh_key payloads preserving all structured fields", () => {
    const payload = {
      v: 1,
      label: "deploy key",
      kind: "ssh_key",
      tags: [],
      fields: { private: "...", public: "..." },
    };
    const result = decodeServerManagedPayload(ITEM_ID, encode(payload));
    expect(result.kind).toBe("ssh_key");
    expect(result.label).toBe("deploy key");
    expect(result.tags).toEqual([]);
    expect(result.fields).toEqual({ private: "...", public: "..." });
  });

  it("round-trips opaque payloads preserving all structured fields", () => {
    const payload = {
      v: 1,
      label: "random blob",
      kind: "opaque",
      tags: ["misc"],
      fields: { value: "secret string" },
    };
    const result = decodeServerManagedPayload(ITEM_ID, encode(payload));
    expect(result.kind).toBe("opaque");
    expect(result.label).toBe("random blob");
    expect(result.tags).toEqual(["misc"]);
    expect(result.fields).toEqual({ value: "secret string" });
  });

  it("falls back to migration fallback for non-JSON input", () => {
    const raw = new TextEncoder().encode("raw secret bytes not json");
    const result = decodeServerManagedPayload(ITEM_ID, raw);
    expect(result.label).toBe("migrated-item_abc");
    expect(result.kind).toBe("opaque");
    expect(result.tags).toEqual(["migrated"]);
    expect(result.fields).toEqual({ value: "raw secret bytes not json" });
  });

  it("falls back to migration fallback for valid JSON with invalid schema (missing fields)", () => {
    const raw = new TextEncoder().encode('{"wrong":"shape"}');
    const result = decodeServerManagedPayload(ITEM_ID, raw);
    expect(result.label).toBe("migrated-item_abc");
    expect(result.kind).toBe("opaque");
    expect(result.tags).toEqual(["migrated"]);
    expect(result.fields).toEqual({ value: '{"wrong":"shape"}' });
  });

  it("synthesizes label when absent but preserves kind from the decoded payload", () => {
    const payload = { v: 1, kind: "login", tags: [], fields: { username: "u", password: "p" } };
    const result = decodeServerManagedPayload(ITEM_ID, encode(payload));
    expect(result.label).toBe("migrated-item_abc");
    expect(result.kind).toBe("login");
    expect(result.fields).toEqual({ username: "u", password: "p" });
  });
});
