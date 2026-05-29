---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Add auth.md agentic registration (WorkOS `anonymous` → user-claimed OTP flow). An agent can `POST /agent/auth` to self-register an unclaimed **personal account** (a placeholder-email owner + personal org + default `server_managed` profile) and receive an `abu_` personal API key + a `clm_` claim token; a human then claims it with an emailed 6-digit OTP (`/agent/auth/claim` → `/agent/auth/claim/complete`), which binds and verifies their real email to the account in place. Adds two-hop discovery (`/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server` with the `agent_auth` block, `/auth.md`) and a `WWW-Authenticate` bootstrap header on 401s. The issued credential is a least-privilege `abu_` management session (never an agent identity, never `access.*`); the agent manages the person's credentials through the normal `items`/`profiles` surface including personal-account owner-reveal. Claim tokens and OTPs are hashed, single-use/bounded, and TTL'd; claim-email-in-use is rejected; expired unclaimed accounts are GC'd. New `account_claims` table (migration `0027`).
