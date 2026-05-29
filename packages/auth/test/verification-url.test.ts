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

  it("carries a same-origin relative callbackURL through as `redirect`", () => {
    const raw = `${API}/api/auth/verify-email?token=t&callbackURL=${encodeURIComponent("/invite/abc")}`;
    const cb = new URL(buildEmailVerificationUrl(raw, APP));
    const login = new URL(cb.searchParams.get("callbackURL") as string);
    expect(login.origin).toBe(APP);
    expect(login.pathname).toBe("/login");
    expect(login.searchParams.get("verified")).toBe("1");
    expect(login.searchParams.get("redirect")).toBe("/invite/abc");
  });

  it("does not carry an external callbackURL into `redirect`", () => {
    const raw = `${API}/api/auth/verify-email?token=t&callbackURL=${encodeURIComponent("https://evil.example/x")}`;
    const cb = new URL(buildEmailVerificationUrl(raw, APP));
    const login = new URL(cb.searchParams.get("callbackURL") as string);
    expect(login.searchParams.get("redirect")).toBeNull();
  });

  it("does not carry a protocol-relative callbackURL into `redirect`", () => {
    const raw = `${API}/api/auth/verify-email?token=t&callbackURL=${encodeURIComponent("//evil.example/x")}`;
    const cb = new URL(buildEmailVerificationUrl(raw, APP));
    const login = new URL(cb.searchParams.get("callbackURL") as string);
    expect(login.searchParams.get("redirect")).toBeNull();
  });

  it("does not loop a /login callbackURL back into `redirect`", () => {
    const raw = `${API}/api/auth/verify-email?token=t&callbackURL=${encodeURIComponent("/login?verified=1")}`;
    const cb = new URL(buildEmailVerificationUrl(raw, APP));
    const login = new URL(cb.searchParams.get("callbackURL") as string);
    expect(login.searchParams.get("redirect")).toBeNull();
  });

  it("returns the input unchanged when it is not a parseable absolute URL", () => {
    expect(buildEmailVerificationUrl("not a url", APP)).toBe("not a url");
  });
});
