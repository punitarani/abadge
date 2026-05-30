/**
 * The REST `/v1` facade must actually route to its tRPC procedures. Regression
 * guard for the v10->v11 caller-shape bug where every `/v1/*` call returned
 * HTTP 500 ("Could not resolve procedure: X") because `resolveCallerMethod`
 * rejected the function-typed v11 caller proxy. The e2e suite previously only
 * exercised `/trpc/*`, so the entire REST facade shipped dead and untested.
 */
import { describe, expect, test } from "bun:test";
import { AbadgeUserClient } from "@abadge/sdk";
import { signupAndLogin } from "../../harness/auth";
import { useTestStack } from "../../harness/test-stack";

const stack = useTestStack();

async function setupOrg(): Promise<{ token: string; orgId: string }> {
  const auth = await signupAndLogin(stack.apiUrl());
  const u = new AbadgeUserClient({ apiUrl: stack.apiUrl(), sessionToken: auth.sessionToken });
  const org = (await u.orgs.create({ name: "REST v1 Org" })) as { id: string };
  return { token: auth.sessionToken, orgId: org.id };
}

describe("REST /v1 facade", () => {
  test("authenticated GET /v1/items resolves the procedure (200, not 500)", async () => {
    const { token, orgId } = await setupOrg();
    const res = await fetch(`${stack.apiUrl()}/v1/items`, {
      headers: { Authorization: `Bearer ${token}`, "X-Abadge-Org-Id": orgId },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items?: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });

  test("POST /v1/items creates an item and round-trips via GET", async () => {
    const { token, orgId } = await setupOrg();
    const headers = {
      Authorization: `Bearer ${token}`,
      "X-Abadge-Org-Id": orgId,
      "Content-Type": "application/json",
    };
    const created = await fetch(`${stack.apiUrl()}/v1/items`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        storageMode: "server_managed",
        payload: { v: 1, label: "rest-key", kind: "opaque", fields: { value: "x" } },
      }),
    });
    expect(created.status).toBe(200);
    const { id } = (await created.json()) as { id: string };
    expect(typeof id).toBe("string");

    const got = await fetch(`${stack.apiUrl()}/v1/items/${id}`, { headers });
    expect(got.status).toBe(200);
  });

  test("GET /v1/audit?limit=3 coerces the numeric query param (200, not 400)", async () => {
    const { token, orgId } = await setupOrg();
    const res = await fetch(`${stack.apiUrl()}/v1/audit?limit=3`, {
      headers: { Authorization: `Bearer ${token}`, "X-Abadge-Org-Id": orgId },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries?: unknown[] };
    expect(Array.isArray(body.entries)).toBe(true);
  });

  test("unauthenticated GET /v1/items returns 401 (not a 500 leaking the procedure name)", async () => {
    const res = await fetch(`${stack.apiUrl()}/v1/items`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code?: string; message?: string };
    expect(body.code).not.toBe("INTERNAL_SERVER_ERROR");
    expect(body.message ?? "").not.toContain("Could not resolve procedure");
  });
});
