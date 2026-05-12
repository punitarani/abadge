---
"@abadge/cli": patch
"@abadge/mcp": patch
---

REST `/v1` canonical surface + onboarding simplification:

- 37 tRPC procedures annotated with `.meta({ openapi: { method, path,
  tags, protect } })` covering organizations, members, profiles, items,
  agents, auth, permissions, access, and audit
- Hand-written REST adapter (`apps/api/src/rest/v1.ts`) compiles a
  routing table from the annotations; reuses the same table to emit
  OpenAPI 3.1 at `GET /v1/openapi.json`
- Pivoted away from `trpc-to-openapi` (peer-depends on zod ^4 while
  this codebase uses Effect Schema) — fallback was explicitly
  permitted in the plan
- `X-Request-Id` middleware: accepts caller-supplied IDs matching
  `/^[a-zA-Z0-9_-]{6,64}$/`, otherwise mints `req_<uuid>`. Echoed on
  every response including error envelopes
- `POST /v1/orgs` auto-creates default `server_managed` profile
  (`externalId="default"`) atomically with the org + owner member +
  audit row; return shape is `{organization, defaultProfile}`
- Onboarding-gate removed entirely: `requireOnboardingComplete`,
  `ONBOARDING_INCOMPLETE` error code, `userHasUsableOrg` helper, and
  `onboarding-gate.ts` deleted
- Field-level OpenAPI schemas remain generic `{type:"object"}` for
  this release; Effect Schema → JSON Schema bridging is a follow-up
