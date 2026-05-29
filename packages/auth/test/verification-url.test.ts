import { describe, expect, it } from "bun:test";
import { buildEmailVerificationUrl } from "../src/verification-url";

const API = "https://api.abadge.io";
const APP = "https://abadge.io";

describe("buildEmailVerificationUrl", () => {
  it("repoints the default `/` callbackURL at the web app login (the prod 404 bug)", () => {
    const raw = `${API}/api/auth/verify-email?token=abc.def.ghi&callbackURL=%2F`;
    const out = new URL(buildEmailVerificationUrl(raw, APP));
    expect(out.searchParams.get("callbackURL")).toBe(`${APP}/login?verified=1`);
    // Token + verify path are preserved — only callbackURL changes.
    expect(out.searchParams.get("token")).toBe("abc.def.ghi");
    expect(out.origin).toBe(API);
    expect(out.pathname).toBe("/api/auth/verify-email");
  });

  it("overrides any caller-supplied callbackURL", () => {
    const raw = `${API}/api/auth/verify-email?token=t&callbackURL=${encodeURIComponent("https://evil.example/x")}`;
    const out = new URL(buildEmailVerificationUrl(raw, APP));
    expect(out.searchParams.get("callbackURL")).toBe(`${APP}/login?verified=1`);
  });

  it("tolerates a trailing slash on the app URL", () => {
    const raw = `${API}/api/auth/verify-email?token=t&callbackURL=%2F`;
    const out = new URL(buildEmailVerificationUrl(raw, "https://abadge.io/"));
    expect(out.searchParams.get("callbackURL")).toBe(`${APP}/login?verified=1`);
  });

  it("returns the input unchanged when it is not a parseable absolute URL", () => {
    expect(buildEmailVerificationUrl("not a url", APP)).toBe("not a url");
  });
});
