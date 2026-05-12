---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Final polish PR for the production revamp: web dashboard, docs
rewrite, verification log.

**Web**
- Single-step org-create onboarding (default profile auto-created
  server-side by PR 3); no resume-profile triage
- Profile list shows `externalId`; create drawer adds an opt-in
  Zero-knowledge toggle (default `server_managed`)
- Permissions UI: target-type radio (Item / Profile), canonical
  `read` / `use` checkboxes only (legacy four hidden), blast-radius
  confirmation dialog on profile-target `read`
- Permissions list renders `profile:<name>` pills for profile-target
  grants

**Docs (`docs/`)**
- `docs/API.md` rewritten as REST endpoint reference
- `docs/CAPABILITY_MATRIX.md` → `docs/CAPABILITIES.md` (one page)
- `docs/CLI.md` reflects new verbs and unified `run` command
- `docs/MCP.md` reflects unified `use_secret`
- Zero `vault.*` references remain in production docs

**Mintlify (`apps/docs/`)**
- Added `use_secret.mdx`, removed `run_with_*` pages, renamed
  `vault.mdx` → `profile-security.mdx`
- New permissions concept page reflects `read` / `use`
- New `migration/v0-to-v1.mdx` migration guide

**Verification**
- `docs/superpowers/2026-05-12-revamp-verification.md` captures the
  cross-PR verification log + deferred follow-ups
