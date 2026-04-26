import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { authEnvelopeMiddleware } from "./middleware/auth-envelope";

type AnyObject = Record<string, unknown>;

describe("auth envelope middleware (§ENV2b)", () => {
  test("wraps bare {message, code} 400 into full envelope", async () => {
    const app = new Hono();
    app.use("*", authEnvelopeMiddleware);
    app.get("/test", (c) => c.json({ message: "Bad input", code: "BAD_AUTH" }, 400));
    const res = await app.request("/test");
    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyObject;
    expect(body).toEqual({
      code: "BAD_AUTH",
      message: "Bad input",
      hint: null,
      meta: null,
    });
  });

  test("passes 2xx through unchanged", async () => {
    const app = new Hono();
    app.use("*", authEnvelopeMiddleware);
    app.get("/ok", (c) => c.json({ ok: true }));
    const res = await app.request("/ok");
    expect((await res.json()) as AnyObject).toEqual({ ok: true });
  });

  test("leaves envelope-shaped bodies (with hint) alone", async () => {
    const app = new Hono();
    app.use("*", authEnvelopeMiddleware);
    app.get("/already-wrapped", (c) =>
      c.json({ code: "X", message: "y", hint: "z", meta: {} }, 400),
    );
    const res = await app.request("/already-wrapped");
    const body = (await res.json()) as AnyObject;
    expect(body.hint).toBe("z");
  });

  test("leaves envelope-shaped bodies (with meta) alone", async () => {
    const app = new Hono();
    app.use("*", authEnvelopeMiddleware);
    app.get("/has-meta", (c) => c.json({ code: "Y", message: "m", meta: { key: "value" } }, 401));
    const res = await app.request("/has-meta");
    const body = (await res.json()) as AnyObject;
    expect(body.meta).toEqual({ key: "value" });
  });

  test("passes 5xx through unchanged", async () => {
    const app = new Hono();
    app.use("*", authEnvelopeMiddleware);
    app.get("/server-error", (c) => c.json({ message: "crash" }, 500));
    const res = await app.request("/server-error");
    expect(res.status).toBe(500);
    const body = (await res.json()) as AnyObject;
    // Should not be wrapped by this middleware (5xx pass-through).
    expect(body).toEqual({ message: "crash" });
  });

  test("preserves RFC 8628 device-flow fields and maps them into the envelope", async () => {
    const app = new Hono();
    app.use("*", authEnvelopeMiddleware);
    app.get("/device-token", (c) =>
      c.json(
        {
          error: "authorization_pending",
          error_description: "User has not yet approved the device.",
        },
        400,
      ),
    );
    const res = await app.request("/device-token");
    expect(res.status).toBe(400);
    const body = (await res.json()) as AnyObject;
    // RFC 8628 fields survive so OAuth2 clients (and the CLI) keep working.
    expect(body.error).toBe("authorization_pending");
    expect(body.error_description).toBe("User has not yet approved the device.");
    // Envelope fields are populated from the OAuth2 fields.
    expect(body.code).toBe("authorization_pending");
    expect(body.message).toBe("User has not yet approved the device.");
    expect(body.hint).toBeNull();
    expect(body.meta).toBeNull();
  });
});
