import { describe, expect, it } from "bun:test";
import {
  evaluateCaching,
  extractHyperdriveJson,
  type HyperdriveConfigResponse,
  hyperdriveIdFromWranglerConfig,
  wranglerGetArgs,
} from "./check-hyperdrive-cache";

describe("check-hyperdrive-cache (§AB-0052)", () => {
  describe("wranglerGetArgs", () => {
    it("does NOT pass --json (wrangler hyperdrive get has no such flag; it prints bare JSON)", () => {
      const args = wranglerGetArgs("abc123");
      expect(args).toEqual(["wrangler", "hyperdrive", "get", "abc123"]);
      expect(args).not.toContain("--json");
    });
  });

  describe("extractHyperdriveJson", () => {
    it("strips the wrangler startup banner before the JSON payload", () => {
      const stdout = ` ⛅️ wrangler 4.95.0\n───────────────────\n{"id":"hd","caching":{"disabled":true}}`;
      expect(JSON.parse(extractHyperdriveJson(stdout))).toEqual({
        id: "hd",
        caching: { disabled: true },
      });
    });

    it("is a no-op when stdout is already bare JSON", () => {
      expect(extractHyperdriveJson('{"id":"hd"}')).toBe('{"id":"hd"}');
    });

    it("returns trimmed input when no JSON object is present (so JSON.parse then fails closed)", () => {
      expect(extractHyperdriveJson("  not json at all  ")).toBe("not json at all");
    });
  });

  describe("hyperdriveIdFromWranglerConfig", () => {
    it("reads hyperdrive[0].id", () => {
      expect(
        hyperdriveIdFromWranglerConfig({ hyperdrive: [{ binding: "HYPERDRIVE", id: "abc123" }] }),
      ).toBe("abc123");
    });

    it("throws when no hyperdrive binding is present", () => {
      expect(() => hyperdriveIdFromWranglerConfig({})).toThrow(/hyperdrive\[0\]\.id/);
      expect(() => hyperdriveIdFromWranglerConfig({ hyperdrive: [] })).toThrow();
    });
  });

  describe("evaluateCaching (fails closed)", () => {
    const withCaching = (disabled?: boolean): HyperdriveConfigResponse => ({
      id: "abc123",
      ...(disabled === undefined ? {} : { caching: { disabled } }),
    });

    it("passes only when caching.disabled === true", () => {
      const verdict = evaluateCaching(withCaching(true));
      expect(verdict.ok).toBe(true);
      expect(verdict.message).toContain("caching disabled");
    });

    it("fails when caching is explicitly enabled (disabled === false)", () => {
      const verdict = evaluateCaching(withCaching(false));
      expect(verdict.ok).toBe(false);
      expect(verdict.message).toContain("caching enabled");
    });

    it("fails closed when the caching key is absent", () => {
      const verdict = evaluateCaching(withCaching(undefined));
      expect(verdict.ok).toBe(false);
      expect(verdict.message).toContain("undefined");
    });
  });
});
