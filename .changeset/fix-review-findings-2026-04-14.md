---
"@abadge/cli": patch
---

Review fixes for PR #89 — closes one P0 onboarding ship-blocker + 17 quality findings.

**CLI (release-surface changes):**
- `abadge vault <unlock|lock|status|change-password>` is now available as `abadge profile <unlock|lock|status|change-password>`. The `vault` top-level command is kept as a deprecated alias that forwards to the new location and prints `⚠ 'vault' is deprecated; use 'profile' instead.` on stderr. `vault` is hidden from `abadge --help`.
- Tagline updated from "Zero-knowledge credential vault CLI" to "Credential control plane for AI agents".

**API / web (internal, noted for release-notes coherence):**
- **P0 — tRPC `userProcedure` tier.** New users hitting `/onboarding` no longer get `401 NO_ORG_MEMBERSHIP` on `organizations.create`. Three bootstrap endpoints (`create` / `list` / `checkSlug`) now use a new `userProcedure` that tolerates zero memberships; everything else still requires a resolved org via `sessionProcedure`.
- **P0 — Better-Auth plugin audit coverage.** `afterCreateOrganization` / `afterDeleteOrganization` hooks emit audit rows with `surface: "auth"` so CLI device-code flows and any other caller that bypasses the tRPC `organizations.create` still produces an `org.create` audit entry.
- Auto-seeded profile renamed `"default"` → `"internal"` so onboarding Step 2 can adopt the row instead of creating a second profile.
- New Dashboard `ProfileCreateDrawer` at `/profiles?create=true` (the link existed; no component was reading the query param).
- Onboarding Step 2 password label, CLI tagline, create-item drawer subtitle, profile-unlock modal text, and several other microcopy strings migrated from "vault" to "profile".
- Register form: `autoComplete` attrs on all 4 inputs, `spellCheck={false}` on email, `minLength=12` on confirm-password, TOS moved from `/onboarding` to `/register`, password strength bar pre-renders an empty bar (no layout shift on first keystroke).
- Per-page `<title>` via `title.template` + 17 route-leaf layouts.
- `defaultProfileCount` on Overview fixed (was filtering by `storageMode === "server_managed"`).
- `StorageModePicker` factored as an accessible radio-group and reused in onboarding + drawer.
