# Full-stack review — v0-refactor branch

**Date:** 2026-04-14
**Branch:** `v0-refactor` (commits through `409c84a` — Phase D)
**Surfaces exercised:** Web (Playwright), API (curl + browser fetch), CLI (`--help`), code-review subagent on Phase A–D.
**Design comparison:** Deferred — the Pencil MCP was not connected, so the 20-artboard "Paper — Abadge / Dashboard" file could not be loaded. Open Pencil and request a rerun for the design-fidelity half.

---

## Resolution status (2026-04-14, branch `fix/review-findings-2026-04-14`)

All findings below have been closed on a follow-up branch. See `docs/superpowers/plans/2026-04-14-fix-review-issues.md` for the plan that drove the fixes.

| # | Status | Closing commit(s) | Notes |
|---|--------|------------------|-------|
| **P0-1** New users cannot onboard | ✅ Fixed | `1db6692`, `8019f18`, `f09afcf`, `f43da76` | New `userProcedure` tier + `OptionalOrgSessionIdentity`. Integration test `onboarding-flow.test.ts` exercises the full middleware chain for a zero-org user. |
| **P0-2** Better-Auth plugin bypass leaves no audit row | ✅ Fixed | `4d41562`, `594d8f6` | `organizationHooks.afterCreateOrganization` + `afterDeleteOrganization` hooks write `surface: "auth"` rows; `safeAuditInsert` helper collapses the three triplicated try/catch blocks. |
| **A-1** Missing `autoComplete` on `/register` | ✅ Fixed | `159e8a2` | All 4 inputs now carry the correct hints. |
| **A-2** Email `spellCheck=true` | ✅ Fixed | `159e8a2` | `spellCheck={false}` on email. |
| **A-3** Confirm-password missing `minLength` | ✅ Fixed | `159e8a2` | Mirrored `minLength=12`. |
| **A-4** Every sub-page `<title>` is just "abadge" | ✅ Fixed | `5daeb83` | Root layout uses `title.template`; 17 per-route `layout.tsx` files set the specific title. |
| **A-5** TOS on wrong page | ✅ Fixed | `208920b` | Moved to `/register` under the submit button; removed from `/onboarding`. |
| **A-6** Password strength bar not pre-rendered | ✅ Fixed | `208920b` | Renders an empty bar with `aria-hidden` when input is empty. |
| **O-1** 401 surfaces as "no membership" banner | ✅ Fixed | (side-effect of P0-1) | The 401 no longer fires, so the misleading banner no longer appears. |
| **O-2** Banner doubles as silent-failure toast | ✅ Fixed | (side-effect of P0-1) | See above. |
| **O-3** "Vault password" label in Step 2 | ✅ Fixed | `54a7e1d` | Renamed to "Profile password" along with state/id/name attrs. |
| **O-4** Storage-mode cards lacked radio semantics | ✅ Fixed | `bd9523e` | Factored `StorageModePicker` with `role="radiogroup"` + `role="radio"` + arrow-key handling. 14 unit tests. |
| **O-5** "Internal profile" jargon | ⚠️ Deferred | — | Wording-only; low risk; call out in a future polish pass. |
| **D-1** `defaultProfileCount` wrong filter | ✅ Fixed | `621ecc6` | Extracted `countDefaultProfiles` helper filtering by `name === "internal"` with 4 unit tests including the regression case. |
| **D-2** Create-item drawer microcopy "your vault" | ✅ Fixed | `0ffbd6b`, `b747c7a` | Purged across 9 user-visible strings in 3 files. |
| **D-3** `Encrypt & save` CTA clipped | ✅ Fixed | `621ecc6` | Dropped `size="sm"` on the submit button. |
| **D-4** Inconsistent storage-mode pickers | ✅ Fixed | `bd9523e`, `06d0278` | Same `StorageModePicker` consumed by onboarding Step 2 and the new Dashboard `ProfileCreateDrawer`. |
| **C-1** CLI exposes both `vault` and `profile` | ✅ Fixed | `6deb2a0` | `vault` subcommands moved under `profile`; `vault` kept as a hidden deprecated alias that forwards + prints a stderr warning. |
| **C-2** CLI tagline still says "vault" | ✅ Fixed | `6deb2a0` | Retagged to "Credential control plane for AI agents". |
| **+ NEW** `/profiles?create=true` opens nothing | ✅ Fixed | `06d0278` | New `ProfileCreateDrawer` reads the query param and lets operators add profiles post-onboarding. |

**Verification:** `bun run format`, `bun run lint`, `bun run typecheck`, `bun run test` all green on commit `514496c`. Full regression sweep logged in Task 7.1 of the plan.

**Pencil / design-fidelity review:** still outstanding — a user with Pencil connected is required.

---

## 1. Headline — P0 ship-blocker

### P0-1. New users cannot onboard via the web app

`resolveUserOrgId` (`packages/trpc/src/server/auth.ts:319-324`) throws `UnauthorizedError{ code: "NO_ORG_MEMBERSHIP", httpStatus: 401 }` whenever the authenticated user has zero memberships. That function is called from `resolveSessionIdentity` (`auth.ts:351`), which is the spine of `sessionProcedure` (`init.ts:65`). Every procedure on the organizations router — `create`, `list`, `checkSlug` (`organizations.ts:889, 894, 899`) — is gated by `sessionProcedure`.

**Effect:** A freshly-registered user hits `/onboarding`, which calls `organizations.create.mutate` (`apps/web/src/app/onboarding/page.tsx:154`), gets `401 NO_ORG_MEMBERSHIP`, and is stuck forever. There is no client-side error toast — the Continue button silently no-ops, and the only signal is a small banner that reads "User has no organization membership — Complete onboarding to create your first organization." (which is the 401 body recycled as UI state).

**Reproduced against live API:**
```
POST /trpc/organizations.create → 401 {"code":"NO_ORG_MEMBERSHIP", ...}
```
with a valid Better-Auth session cookie (confirmed by `GET /api/auth/get-session → 200` returning the user object).

**Introduced by:** `0c8632f` (Phase A). The prior review had flagged `sessionProcedure` for lacking org scoping; the fix was to resolve the org inside `resolveSessionIdentity`, but it did not carve out the three bootstrap endpoints that a zero-org user must be able to call.

**Suggested fix:** Introduce a three-tier procedure hierarchy in `init.ts`:
1. `publicProcedure` — no auth.
2. `userProcedure` — authenticated, org **optional**, used for `organizations.create|list|checkSlug` (and `profiles.bootstrap` if reached pre-org).
3. `sessionProcedure` — authenticated and org resolved (current behavior), for everything else.

Then `organizations.create|list|checkSlug` switch to `userProcedure`. `resolveSessionIdentity` stays unchanged; a new `resolveSessionIdentityOptionalOrg` variant returns `organizationId: null` when there are zero memberships (and still rejects 2+ without the `X-Abadge-Org-Id` header).

### P0-2. Better-Auth plugin bypass leaves no abadge audit entry

While debugging P0-1 I created the first org via `POST /api/auth/organization/create` (the Better-Auth `organization` plugin endpoint). It succeeded (200) with a valid owner membership, and the dashboard proceeded. But the audit log shows only `profile.create` rows — **no `organization.create` row**.

The abadge tRPC `organizations.create` presumably writes an audit entry. The Better-Auth plugin path does not. Any future flow that somehow hits the plugin route (a support script, a migration, or a workaround for P0-1) silently breaks the "every attempt is audited" invariant in `AGENTS.md`.

**Suggested fix:** Override the Better-Auth org-plugin hooks in `packages/auth` so every create/delete/update on the `organization` table emits an `organization.*` audit entry, or remove the plugin endpoint entirely once P0-1 is fixed and the tRPC path is reachable.

---

## 2. Auth surface — register/login

Findings below are all independently verifiable via DevTools on `/register`.

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| A-1 | P2 | Every input on `/register` has `autocomplete=""`. Password managers (1Password, Bitwarden) will not fill this form cleanly. | Add `autocomplete="name"`, `"email"`, `"new-password"`, `"new-password"`. |
| A-2 | P3 | `spellCheck` is `true` on Full name and Email inputs. Users see red squiggles under valid emails and surnames. | `spellCheck={false}` on email; optional on name. |
| A-3 | P3 | Confirm-password has no `minLength`. Only the first password enforces 12. | Mirror `minLength={12}` and the React-level equality check. |
| A-4 | P3 | `<title>` on every sub-page is just "abadge" — the homepage has "abadge \| The credential control plane for AI agents". | Set a per-page `title` via Next.js metadata API. |
| A-5 | P2 | Terms of Service / Privacy Policy acceptance text lives on `/onboarding` step 1, **after** the account is already created. The `/register` page has no TOS reference. | Move the "by continuing" line under the register button (or require an explicit checkbox). |
| A-6 | P3 | Password strength bar does not render until the user types a character. Design shows it pre-rendered at minimum height. Previously flagged; still open. | Render `<PasswordStrength value="" />` as an empty bar instead of returning `null`. |

---

## 3. Onboarding surface

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| O-1 | P0 | See P0-1 above — `organizations.create` returns 401 for zero-org users. | Procedure-tier split. |
| O-2 | P1 | On tRPC 401, the onboarding page shows **"User has no organization membership — Complete onboarding to create your first organization."** This is the server's error hint re-used as UI. When the server actually returns "please sign in again" or "rate limited", the same banner will still show this onboarding-specific copy. | Render a real error toast keyed on `error.code`; keep the no-memberships banner only for the happy "first-time user" path. |
| O-3 | P2 | Step 2 field is labeled **"Vault password"**. The product has been renamed to "profile"; this label leaks legacy terminology. | Rename to "Profile password" (or "Encryption password"). |
| O-4 | P3 | Step 2 storage-mode picker uses `<button>` cards without `aria-pressed` or radio semantics. Screen readers hear two identical buttons. | Either `role="radio"` + `aria-checked`, or a real `<fieldset>` with hidden radios. |
| O-5 | P3 | "Internal profile" jargon is unexplained to a new user. The card body calls it the "organization's own operational vault for shared secrets" — that's good, but the step-indicator label "Internal profile" is terse and confusing out of context. | Consider "Default profile" with a popover explaining why. |

---

## 4. Dashboard — Overview page

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| D-1 | P2 | Overview stat says `Profiles under custody: 1 / **0 default (internal)**`. The internal profile IS the default — the count should be `1`. Previously flagged; still open. | Compute `defaultProfileCount` as `profiles.filter(p => p.name === 'internal').length` or drive it from a `isDefault` flag. |
| D-2 | P3 | Create-item drawer sub-header: "Add a secret to your **vault**." Same legacy terminology leak. | "Add a secret to your profile." |
| D-3 | P3 | Create-item drawer: "Encrypt & s…" primary CTA is truncated. Either the drawer width is too narrow or the button is given `max-width` + `text-overflow: ellipsis`. | Allow the button to expand; it's the only primary action in the drawer. |
| D-4 | P3 | Create-item storage-mode uses proper `<input type=radio>` with descriptions. Onboarding Step 2 uses a different component for the same decision. | Factor a single `StorageModePicker` component and use it in both places. |

---

## 5. CLI surface

| # | Severity | Finding |
|---|----------|---------|
| C-1 | P2 | `abadge --help` lists both `vault` (legacy) and `profile` (new) as top-level commands. `vault` was repurposed to "profile encryption operations" (change-password / lock / unlock), but keeping the old name confuses users who followed the v0 rename. Consider `abadge profile unlock` / `profile lock` / `profile rekey` and deleting the `vault` top-level. |
| C-2 | P2 | `abadge` is marketed as "Zero-knowledge credential vault CLI" in `--help`. Products marketed as "vaults" often imply server storage — and this CLI now supports both zero-knowledge and server-managed. Minor wording consistency issue. |

Round-3 CLI/MCP tests (`cli-mcp-test-report-3.md`) already passed the full workflow; I did not rerun them.

---

## 6. API surface — spot checks

- `GET /health` → `200 {"status":"ok"}` ✅
- `GET /api/auth/get-session` (no cookie) → `200 null` ✅
- `GET /trpc/items.list` (no cookie) → `401 UNAUTHORIZED` ✅
- CORS / credentials wiring works across origins (`:3000` → `:8787`) — verified by the Better-Auth cookie round-trip. The earlier 401s were NOT a cookie-cross-origin issue, despite initial suspicion.

No additional API-surface defects surfaced during the smoke.

---

## 7. Code-level verification of prior 🔴 findings

Dispatched a code-review subagent on commits `0c8632f`, `b8fe395`, `e4aebe3`, `409c84a`. Result — all eight 🔴 blockers from `v0-checklist-review.md` are closed:

| # | Issue | Evidence |
|---|-------|----------|
| 1 | `profiles` uniqueIndex on (orgId, name) | `packages/db/src/schema/profiles.ts:25` |
| 2 | `items.create` reads `profiles` not `vaults` | `packages/trpc/src/server/routers/items.ts:71-82` |
| 3 | `items.create` sets `organizationId` + `profileId` | `items.ts:98-99` (ZK), `116` (server-managed — sets orgId only; see note below) |
| 4 | `items.list` org-scoped | `items.ts:152` |
| 5 | `org.update` requires `owner` | `organizations.ts:417` |
| 6 | `items.organizationId notNull()` | `packages/db/src/schema/items.ts:11-12` |
| 7 | `RevealAccessSchema`/`MountAccessSchema` carry `field?` | `packages/core/src/schemas.ts:165-176` |
| 8 | `AuditQuerySchema` carries `orgId/profileId/surface/field` | `schemas.ts:178-191`; router exposes `profileId/surface/field`; `orgId` locked to session (intentional) |

**Minor note — server-managed items + profileId.** The server-managed `items.create` path does **not** set `profileId`. ZK items always do. The column is nullable, so nothing crashes, but audit filters by `profileId` will never match server-managed items. Either (a) add `profileId` to `ServerManagedCreateItemSchema` and pass it, or (b) document that server-managed items are profile-less by design.

**Rename cutover:** clean. No live references to `vaults`/`principals`/`grants`/`operatorToken`/`resolveDisplay`/`use_without_reveal`. A few intentional `@deprecated` shims remain (`AbadgeClientConfig` union in `sdk/client.ts:110`, `createSessionApiClient` in `cli/client.ts:169`) — these are documented migration bridges.

**Cascade atomicity:** `onAgentRevoked` and `onItemDeleted` are now wrapped in `db.transaction()` (`agents.ts:297-323`, `items.ts:334-357`). Good.

**Dead export:** The legacy `audit-log.ts` schema file is still exported from `packages/db/src/schema/index.ts:6` but has zero runtime importers. Safe to delete.

---

## 8. What I did *not* cover

- **Paper / Pencil design fidelity** — Pencil MCP not connected. Cannot compare against the 20 artboards. Start Pencil and re-run if wanted.
- **Full item → agent → permission → access → audit golden path through the UI.** Blocked at onboarding step 1 by P0-1. Workaround-created the org via Better-Auth plugin, but the ZK profile unlock + item creation requires interactive crypto and was not exercised past drawer render.
- **MCP tool-call integration test.** Round-3 report passed all tool calls; no regressions suspected in Phase A–D.
- **SDK type-level review.** The code-review subagent covered the `AbadgeClientConfig` deprecation bridge; nothing else flagged.

---

## 9. Suggested priority order

1. **P0-1** — fix procedure tier (unblocks every new signup).
2. **P0-2** — audit the Better-Auth org plugin path or remove it.
3. **D-1** — `defaultProfileCount` subtitle fix (very visible, trivial).
4. **A-1** — autocomplete attrs on `/register` (trivial, high UX win for a credential product).
5. **O-3** — rename "Vault password" → "Profile password" on onboarding.
6. **D-2 / D-3 / C-1** — remaining terminology + truncation cleanups.
7. Everything else batched as a polish sprint.
