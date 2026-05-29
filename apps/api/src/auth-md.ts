import { AGENT_POSTCLAIM_SCOPES } from "@abadge/core";
import { createServerCaller } from "@abadge/trpc/server";
import type { Context } from "hono";
import { errorEnvelope, statusFromError } from "./rest/v1";
import type { Bindings } from "./types";

/**
 * WorkOS auth.md agentic-registration surface: the two-hop discovery documents,
 * the `/auth.md` skill manifest, and the unauthenticated `/agent/auth*` REST
 * endpoints. Business logic lives in the tRPC `agentAuth` router; these are thin
 * adapters that map the protocol's exact request/response shapes onto it.
 */

const trimSlash = (raw: string | undefined): string => (raw ?? "").replace(/\/$/, "");

export function protectedResourceMetadata(env: Bindings): Record<string, unknown> {
  const api = trimSlash(env.ABADGE_API_URL);
  return {
    resource: `${api}/`,
    authorization_servers: [`${api}/`],
    scopes_supported: [...AGENT_POSTCLAIM_SCOPES],
    bearer_methods_supported: ["header"],
  };
}

export function authorizationServerMetadata(env: Bindings): Record<string, unknown> {
  const api = trimSlash(env.ABADGE_API_URL);
  return {
    issuer: `${api}/`,
    authorization_servers: [`${api}/`],
    scopes_supported: [...AGENT_POSTCLAIM_SCOPES],
    bearer_methods_supported: ["header"],
    agent_auth: {
      skill: `${api}/auth.md`,
      register_uri: `${api}/agent/auth`,
      claim_uri: `${api}/agent/auth/claim`,
      revocation_uri: `${api}/agent/auth/revoke`,
      identity_types_supported: ["anonymous"],
      anonymous: { credential_types_supported: ["api_key"] },
    },
  };
}

export function authMdDocument(env: Bindings): string {
  const api = trimSlash(env.ABADGE_API_URL);
  return `# abadge — agent registration

abadge is an agent credential firewall. An agent can register an unclaimed
personal account, then a human claims it with an emailed one-time code. After
the claim the agent manages that person's credentials in a personal vault.

## 1. Discover
GET ${api}/.well-known/oauth-protected-resource
GET ${api}/.well-known/oauth-authorization-server  (see the \`agent_auth\` block)

## 2. Register (anonymous)
POST ${api}/agent/auth
Body: { "type": "anonymous", "requested_credential_type": "api_key" }
Returns: { credential (api_key), claim_token, claim_url, scopes, post_claim_scopes }
The api_key authenticates immediately but is inert until the account is claimed.

## 3. Claim
POST ${api}/agent/auth/claim
Body: { "claim_token": "clm_...", "email": "owner@example.com" }
abadge emails the owner a 6-digit code. Ask the human for it.

## 4. Complete the claim
POST ${api}/agent/auth/claim/complete
Body: { "claim_token": "clm_...", "otp": "123456" }
Returns: { "status": "claimed" }. The api_key's scopes are upgraded in place.

## 5. Use the credential
Send \`Authorization: Bearer <api_key>\`. After claim the agent can read its vault
and create items in its personal "default" profile.

## Errors
On a 401 with \`WWW-Authenticate: Bearer resource_metadata=...\`, restart at step 1.
Codes: invalid_claim_token, otp_invalid, otp_expired, rate_limited.

## Revocation
There is no agent-facing revoke. The account owner revokes the agent from the
abadge dashboard; a revoked credential returns 401.
`;
}

async function handleAgentAuth(
  c: Context<{ Bindings: Bindings }>,
  call: (
    caller: ReturnType<typeof createServerCaller>,
    body: Record<string, unknown>,
  ) => Promise<unknown>,
): Promise<Response> {
  let body: Record<string, unknown> = {};
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/json")) {
    body = await c.req
      .json()
      .then((parsed) =>
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {},
      )
      .catch(() => ({}));
  }

  try {
    const caller = createServerCaller(c.req.raw, c.env);
    const result = await call(caller, body);
    return c.json(result as Record<string, unknown>, 200);
  } catch (err) {
    return c.json(errorEnvelope(err), statusFromError(err) as 400);
  }
}

export const handleAgentRegister = (c: Context<{ Bindings: Bindings }>): Promise<Response> =>
  handleAgentAuth(c, (caller, body) =>
    caller.agentAuth.register(body as Parameters<typeof caller.agentAuth.register>[0]),
  );

export const handleAgentClaim = (c: Context<{ Bindings: Bindings }>): Promise<Response> =>
  handleAgentAuth(c, (caller, body) =>
    caller.agentAuth.claim(body as Parameters<typeof caller.agentAuth.claim>[0]),
  );

export const handleAgentClaimComplete = (c: Context<{ Bindings: Bindings }>): Promise<Response> =>
  handleAgentAuth(c, (caller, body) =>
    caller.agentAuth.claimComplete(body as Parameters<typeof caller.agentAuth.claimComplete>[0]),
  );
