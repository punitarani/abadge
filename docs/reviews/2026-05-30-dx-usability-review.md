# DX & Usability Review — all surfaces (CLI, SDK, MCP, API, Web)

**Date:** 2026-05-30
**Branch:** `feat/serene-shamir-f8568e` (off `main` @ `1780564`)
**Goal:** Maximize developer experience and practical usability across every surface. Walk each
surface as the ICP (and adjacent users) building *on top of* abadge, executing flows where possible
rather than only reading code. Collect issues, limitations, and concrete improvements.

**ICPs (from `docs/MOTIVATION.md` / `docs/abadge.md`):**
- Teams building browser agents that sign into sites on behalf of users
- Workflow automation calling third-party APIs with customer credentials
- Internal copilots needing scoped access to company systems
- B2B platforms acting on behalf of customer accounts

**Adjacent personas exercised:** CLI developer, SDK/TypeScript integrator, AI-agent builder (MCP),
REST/Python API consumer, dashboard operator, and the daemon (local injection substrate).

## Method

1. **Persona journeys** — fan out one reviewer per surface, walking the end-to-end flow against
   real code + docs + examples.
2. **Cross-cutting dimensions** — error/envelope quality, cross-surface naming, doc accuracy,
   capability-model clarity, observability/debuggability.
3. **Live execution** — main agent drives one local stack, runs the canonical time-to-first-secret
   path + one example per surface, clicks the dashboard. Lived papercuts > read papercuts.
4. **Adversarial verify** — every finding is cross-referenced against `AGENTS.md` invariants. A
   deliberate security tradeoff is reframed ("is the rationale surfaced to the user?"), never filed
   as "remove the friction."

## Severity rubric (grounded in ICP impact)

| Sev | Meaning |
|-----|---------|
| **S1** | Blocks time-to-first-secret / first integration — user cannot proceed without external help |
| **S2** | Major friction — user proceeds but wastes significant time, hits a confusing dead-end, or builds the wrong mental model |
| **S3** | Papercut — confuses on first contact, recoverable; or a missing affordance an ICP will want |
| **S4** | Polish — wording, consistency, nice-to-have |
| **SEC** | Looks like friction but is a deliberate security invariant — reframed as "surface the rationale," never "remove it" |

## Status legend

`unverified` → raised, not yet confirmed against code · `verified` → confirmed file:line + reproduced experience · `invariant` → deliberate security tradeoff · `fixed` · `wontfix`

---

## Executive summary

abadge's product model is coherent and the security posture is genuinely well-built (the `--value` TTY rejection,
the §RED1 MCP redaction, the ZK boundary — these are done right). The DX gap is **not** the model; it's that the
**non-TypeScript integration surface is broken**, the **flagship onboarding artifacts don't run as written**, and
a layer of naming/consistency papercuts erodes trust on first contact. A developer who is a TypeScript user on the
CLI/SDK/web (the `/trpc` path) has a decent experience marred by papercuts; a developer who is the documented ICP
"building on top of us" from Python/Go/curl hits a wall on call #1.

**The five things that matter most:**

1. **The REST `/v1` facade returns 500 on every call** (DX-S1-A). One-line guard bug in `v1.ts:205` (tRPC v11
   caller nodes are functions, not objects). Kills all three non-TS examples (`08-rest-curl`, `09-agent-python`
   agent-access, `10`'s finale). The one-line fix is **proven live** (items/agents/orgs/POST → 200), but a
   *second* defect (numeric query-param coercion — `?limit=3` still 400s) must land alongside it to fully restore
   the surface. Still the highest-leverage fix in the review.
2. **`echo -n 'secret' | abadge item add` silently stores nothing** (DX-S1-B). The flagship quickstart's
   store-a-secret step no-ops (no newline → masked prompt never resolves). Breaks the #1 onboarding path.
3. **The capability vocabulary is a cross-surface trap** (DX-001 + 3 corroborating findings). Docs/CLI-help/SDK
   teach `read`/`use`; item-target grants reject them and the CLI/SDK can't target a profile to make them work.
4. **Silent destructive/confusing API aliases** (DX-S2-D `permissions.update()`=revoke; `profiles.update()`=
   changePassword; `org add` can't `--json`; `mcp-config <id>` dead-ends). Footguns and broken scripting on the
   management surface.
5. **Errors mask their real cause** (daemon "start the daemon" catch-all; web audit hides denial reason; no
   `requestId` on SDK errors). When an integration breaks, the developer can't self-diagnose.

**Method confidence:** the read-only fan-out (54 verified findings) was strong but **structurally blind** to the
two S1s — both required *executing* the stack. The adversarial verify stage earned its keep (killed 2 false
premises, reframed 7 security invariants, and I caught 1 more false positive — a harness artifact — myself).

## Prioritized fix roadmap

| Priority | Fix | Effort | Why |
|----------|-----|--------|-----|
| **P0** | `v1.ts:205` guard accepts `function` **+** coerce numeric/boolean query params in `readQueryParams` (DX-S1-A) | small + a `/v1` e2e test | Restores the entire non-TS API + all 3 API examples (guard fix proven live; query-coercion needed for paginated GETs) |
| **P0** | `item add` reads piped stdin to EOF as value; prompt chrome → stderr (DX-S1-B) | small | Unbreaks the flagship quickstart |
| **P0** | Add `/v1/*` coverage to e2e (the gap that hid both above) | medium | Prevents silent regressions of the REST facade |
| **P1** | Capability vocab: CLI/SDK accept `read`/`use` on item grants (auto-map to legacy) OR add profile-target grants; fix `--help`/docs (DX-001) | medium | Removes the most-traveled grant dead-end |
| **P1** | Remove/neuter `permissions.update()` & `profiles.update()` aliases (DX-S2-D) | small | Destructive footguns |
| **P1** | `org add --json`; `mcp-config <id>` fetch-by-id (DX-S2-A/B) | small | Unblocks CI scripting + MCP onboarding |
| **P1** | Surface-aware error hints: no-org → `abadge org add`; daemon catch-all → distinguish locked/down/denied; add `requestId` to `AbadgeApiError` (DX-S2-C, S1-C, S2-F) | medium | Self-service debuggability |
| **P2** | Reconcile `ownerReveal`/abu_ invariant wording + decide team-org gating → **route to `abadge-security-audit`** (SA-1) | — | Trust-model consistency |
| **P2** | SEC-friction messaging pass (auto-lock window, MCP daemon hint retargeting, denial hint with grant command, RED1 failure hint) | medium | Make deliberate friction self-explaining |
| **P3** | Naming consistency sweep (vault/profile/master-password; JSON shapes; raw enums/DB columns in CLI output); docs-accuracy sweep | medium | Reduce first-contact confusion |

---

## Findings log (append-only)

<!-- Each finding: ID · surface · persona · severity · status · evidence (file:line) · the lived experience · the fix -->

### DX-001 · CLI · S2 (calibration, hand-verified) · `verified`

**Surface:** CLI · **Persona:** first-time CLI developer following `--help`

**The experience:** A developer runs `abadge permission create --help`, reads *"Capability: read, use, or
a legacy name…"* (`packages/cli/src/commands/permission.ts:17`), and naturally types the canonical
names the rest of the product documents:

```
abadge permission create --agent-id A --item-id I --capability read
```

The CLI accepts `read`/`use` locally (validates against `CAPABILITIES`, which includes them —
`permission.ts:42`) and forwards to the API. The API's **item-target** grant path then rejects it:

> `Item-target grants do not accept canonical capability 'read'.`
> hint: *"Item-target permissions admit legacy capabilities only (read_ciphertext, reveal_plaintext,
> mount_env, mount_file). To grant canonical 'read' or 'use', target a profile instead."*
> (`packages/trpc/src/server/routers/permissions.ts:298-305`)

But `abadge permission create` has **only** `--item-id` (`requiredOption`, `permission.ts:14`) — there is
**no `--profile-id` flag**. The server's own remediation ("target a profile instead") is impossible to
follow from the CLI. The user is forced to reverse-engineer that they must instead pass a *legacy* name
(`mount_env`/`reveal_plaintext`/…) — the exact opposite of what `--help` told them. The quickstart example
sidesteps this by hardcoding `mount_env` (`examples/cli/04-quickstart.sh` step 6), which silently signals
the help text is wrong.

**Evidence:** `packages/cli/src/commands/permission.ts:14,17,42`; `packages/trpc/src/server/routers/permissions.ts:289-305`; `packages/core/src/constants.ts:28-68`; `examples/cli/04-quickstart.sh` step 6.

**Why it matters:** This is the single most-traveled CLI grant path. The help text actively steers users
into a rejected call whose remediation the CLI can't perform. Either (a) the CLI should expose
profile-target grants (`--profile-id`) so `read`/`use` work as advertised, or (b) the `--help` should not
offer `read`/`use` for an item-only command, or (c) the CLI should auto-map `read`→legacy for item grants.
Best fix: add `--profile-id` (mutually exclusive with `--item-id`) AND auto-translate canonical→legacy for
item targets, so the help text is never a lie.

**Severity:** S2 — does not block (a determined user finds the legacy names) but the product's *own help text*
leads to a dead-end error on the most common command; high "made me re-read the docs three times" cost.

---

## ⬛ HEADLINE — S1 ship-blockers (hand-verified by live execution)

### DX-S1-A · API · The entire REST `/v1` facade returns HTTP 500 on every call

**Surface:** HTTP API · **Persona:** any non-TypeScript integrator (Python/Go/curl) — `examples/api/08-rest-curl`

**The experience:** A developer follows the documented REST path. `docs/abadge.md` advertises an "API |
Everything | tRPC on Cloudflare Workers, the canonical control plane," there's a 42-route OpenAPI spec at
`/v1/openapi.json` (returns 200), and a shipped example (`examples/api/08-rest-curl`). **Every single REST
call fails with HTTP 500.** Reproduced live against a real wrangler-dev stack, authenticated with a valid
Better Auth session bearer:

```
POST /v1/orgs        → 500 {"code":"INTERNAL_SERVER_ERROR","message":"Could not resolve procedure: organizations.create"}
POST /v1/items       → 500 {"code":"INTERNAL_SERVER_ERROR","message":"Could not resolve procedure: items.create"}
GET  /v1/items/{id}  → 500 {"code":"INTERNAL_SERVER_ERROR","message":"Could not resolve procedure: items.get"}
GET  /v1/items       → 500 {"code":"INTERNAL_SERVER_ERROR","message":"Could not resolve procedure: items.list"}
GET  /v1/agents      → 500 ... agents.list
GET  /v1/audit       → 500 ... audit.list
```

The 500 body leaks the internal tRPC procedure name and carries `hint:null, meta:null`. An unauthenticated
call also 500s (no `WWW-Authenticate`, no 401) because resolution fails before any auth check.

**Why it slipped through:** the e2e API tests hit `/trpc/items.list` directly
(`apps/e2e/src/tests/api/error-envelope.test.ts:42`), never the REST `/v1/*` facade — so the entire surface
is untested. The healthy path is `/trpc/*` (CLI, SDK, web all use it). This is the **REST facade**, not "the
API," but it is the *only* documented path for non-TS integrators.

**Mechanism (CONFIRMED + one-line fix verified):** `handleV1Request` builds a tRPC caller and resolves the
procedure via `resolveCallerMethod(caller, "items.list")`, which walks `caller["items"]["list"]` but guards each
hop with `if (current === null || typeof current !== "object") return null` (`apps/api/src/rest/v1.ts:204-205`).
**In tRPC v11 the caller proxy nodes are callable functions, not plain objects** — `typeof caller === "function"`,
`typeof caller.items === "function"`, and `caller.items.list` is a function. So the guard's
`typeof current !== "object"` rejects the caller on the *first* segment → returns null → the `!method` branch →
500, for **every** procedure. This is a tRPC v10→v11 regression (v10 callers were plain nested objects). Verified
in-process: the current guard yields `NULL→500` for `items.list`/`items.create`/`organizations.create`/`audit.list`;
a guard that also accepts `"function"` (`typeof cur !== "object" && typeof cur !== "function"`) yields `OK` for
all four. **Fix: one line at `v1.ts:205`.** (Secondary: the 500 leaks the internal procedure name and there's no
pre-auth 401/`WWW-Authenticate` — but those are moot once resolution is fixed.)

**Blast radius (CONFIRMED — every shipped non-TypeScript example is at least partially dead):**
- `examples/api/08-rest-curl/manage.sh` → uses `/v1/items`, `/v1/audit`, `/v1/access/*` → **fully dead.**
- `examples/api/09-agent-python/agent_read.py` → uses `/v1/agents/{id}/sessions/challenge`, `…/exchange`,
  `/v1/access/{item}/read` (lines 128/141/161) — the entire non-TS **agent-access** path → **dead** (same handler).
- `examples/api/10-agentic-registration-python/register.py` → steps 1–3 hit `/agent/auth*` (the *separate*
  `apps/api/src/auth-md.ts` handler — likely OK), but step 4 `POST /v1/items` (the "prove the credential works"
  finale) → **dead.**
- The TypeScript SDK + CLI + web are **unaffected** — they use `/trpc/*` (healthy, e2e-covered). So this is the
  REST *facade* for non-TS integrators, not "the API." But it is the *only* documented non-TS path.

**Severity:** S1. A documented, exampled, OpenAPI-specced integration surface that is 100% non-functional is
the worst possible DX for the "build on top of us" ICP.

---

### DX-S1-B · CLI · `echo -n 'secret' | abadge item add` silently stores nothing (breaks the flagship quickstart)

**Surface:** CLI · **Persona:** first-time developer running `examples/cli/04-quickstart.sh`

**The experience:** The flagship quickstart (and `docs/CLI.md`) teach the secure pattern: pipe the secret via
stdin to avoid shell-history leaks, using `echo -n` so no trailing newline contaminates the stored value:

```bash
ITEM_JSON="$(echo -n 'super-secret' | abadge item add --label demo --kind api_key --json)"
ITEM_ID="$(printf '%s' "$ITEM_JSON" | jq -r '.id')"
```

Run live, this **silently no-ops**: the item is never created, exit code is `0`, no error, and stdout
contains only the literal prompt label `Value (secret):`. `jq` then parses empty/garbage.

**Mechanism (confirmed, unit-level):** with `--value` omitted, `readCreateItemValues` always calls
`prompt("Value (secret): ", true)` → `promptSilent` (`packages/cli/src/prompt.ts:60-86`), which resolves only
when it sees `\n`/`\r` (`applySilentInputChunk`, `prompt.ts:20-49`). Piped input from `echo -n` has **no
newline**, so on stdin EOF the promise never resolves, the create never fires, and the process exits 0.
Isolated repro: `applySilentInputChunk("secret", "")` → `{done:false}`; `applySilentInputChunk("secret\n", "")`
→ `{done:true}`. Reproduced end-to-end against the live stack (no item row, no JSON, exit 0).

**Secondary defect:** `promptSilent` writes the label to **stdout** (`prompt.ts:64`), so even the
newline-terminated path pollutes `--json` output, corrupting `| jq`.

**Why it slipped through:** the e2e CLI test does not create items via the CLI stdin path (it provisions via
SDK), so the regression is uncovered.

**Severity:** S1 for the stdin path — the single most important onboarding artifact (the quickstart) does not
work as written. Fix: read piped stdin to EOF as the value when `process.stdin.isTTY` is false (don't route
non-TTY input through the interactive masked prompt); write all prompt chrome to stderr.

---

*(The workflow's `daemon-error-masking-catchall`, originally rated S1, is confirmed but is a debugging-misdirection,
not a functional ship-blocker — relocated to **DX-S2-H** below with corrected file:line.)*

---

## 🟧 S2 — major friction (verified live unless noted)

### DX-001 · CLI · Capability help invites `read`/`use` on item grants, API rejects them, CLI can't follow the remedy
*(full writeup above — the calibration finding; hand-verified)*

### DX-S2-A · CLI · `org add` has no `--json`, breaking first-step scripting
`item add`, `agent add`, `profile list`, `permission create`, `audit`, `org list` all support `--json`; **`org
add` does not** (`packages/cli/src/commands/org.ts:11-23` — emits only `success("Organization created: NAME
(ID)")`). A CI script (a documented use case, `examples/cli/05-ci-cd.sh`) cannot create-an-org-and-capture-its-id
in one step; it must `org add` then `org list --json | jq`. Reproduced live: `org add --json` → `error: unknown
option '--json'`. Fix: add `--json` to `org add` returning the created org.

### DX-S2-B · CLI · `agent mcp-config <id>` dead-ends right after registering an MCP agent
After `abadge agent add --kind local_mcp --json` (which stores the keypair to
`~/.abadge/agents/<id>.ed25519.jwk`), running `abadge agent mcp-config <id>` fails:
`✗ No local_mcp agent is registered on this machine. Run `abadge agent add --kind local_mcp --mcp-config`
first.` (`packages/cli/src/commands/agent.ts:314-331`). The `<id>` argument is a lie — `mcp-config` reads the
agent from `config.json`, which is only written when you pass `--mcp-config` at `agent add` time. The scripting
path (`--json`) and the snippet path (`--mcp-config`) are mutually exclusive by design (`agent.ts:279-285`), so
a user who registered via `--json` can never get the Claude Desktop snippet for that agent. Reproduced live.
Fix: make `mcp-config <id>` fetch the agent by id from the API and synthesize the snippet from the local key
file, independent of `config.json`.

### DX-S2-C · CLI · No-org gate hint says "Complete onboarding" — meaningless to a CLI user
A zero-org user hits `✗ User has no organization membership → Complete onboarding to create your first
organization.` on nearly every command. "Onboarding" is a **web-only** concept; the CLI has no onboarding flow.
The actionable remedy (`abadge org add --name <name>`) is never named. Reproduced live across `item add`,
`agent add`, `audit`, `export`, etc. Fix: surface-aware hint — `Run \`abadge org add --name <name>\` to create
your first organization, or \`abadge org use <id>\` to select one.`

### DX-S2-D · SDK · `client.permissions.update()` silently **deletes** the permission — *CONFIRMED*
`AbadgeUserClient.permissions.update(permissionId)` is aliased straight to `revoke`:
`update: (permissionId) => …this.client.permissions.revoke.mutate({ permissionId })`
(`packages/sdk/src/client.ts:644-647`) — and `delete` likewise (`:649-652`). The type signature takes **only** a
`permissionId` with no update payload (`client.ts:515`), so "update" structurally cannot update — it destroys
the grant. A consumer reaching for `permissions.update()` (a normal expectation) silently **revokes access**.
Permissions are immutable rows (revoke is the only mutation), so the honest fix is to remove `update` from the
permissions namespace (or make it throw a "permissions are immutable; use revoke" error), not alias it to a
destructive op.

### DX-S2-E (cluster) · Web/CLI ZK-profile traps — *workflow-found*
- `cli-zk-profile-unbootstrappable` (S2, c=0.9): the CLI can *create* a `zero_knowledge` profile but offers no
  way to bootstrap/unlock/use it; the error hint steers into the dead end.
- `zk-storage-default-empty-org-trap` (S2, c=0.88) + `item-create-no-profile-picker` (S2, c=0.9): the web
  create-item form defaults to Zero-knowledge, but a freshly-seeded org has only a `server_managed` profile, so
  the first save fails; and there's no profile picker, so items silently land in the default profile.
- `zk-item-ignores-active-profile` (S2, c=0.9): CLI `item add` ignores `--profile`/active profile for ZK and
  picks "the first ZK profile" the server returns.
- `agent-no-connect-instructions` (S2, c=0.8): after registering an agent in the dashboard, there's no
  instruction on how to actually connect it — the keypair path dead-ends.

### DX-S2-H · CLI/MCP · Every daemon/ZK failure collapses to "start the daemon" (masks the real cause) — *CONFIRMED, corrected location*
A locked profile, an identity change, a wrong field name, or any daemon RPC error all surface as the same
misleading message telling the user to start a daemon that may already be running:
- MCP: `packages/mcp/src/resolve-secret.ts:24-30` — a **bare `catch {}`** (no error binding; the real error is
  *discarded*) → "Zero-knowledge items require the local daemon for decryption. Start the daemon with: abadge
  daemon start && abadge profile unlock."
- CLI: `packages/cli/src/commands/run.ts:54-63` — catches any non-`AbadgeApiError`, keeps it only as `cause`, and
  emits "abadge run requires the local daemon. Start it with: abadge daemon start && abadge profile unlock."

Fix: branch on the daemon's RPC error code (`VAULT_LOCKED` → "Profile auto-locked — run `abadge profile
unlock`"; `ECONNREFUSED`/no-socket → "Daemon not running — `abadge daemon start`"; field/AAD error → name the
field), instead of one catch-all. S2 (debugging-misdirection), not a functional blocker.

### DX-S2-F · Observability — *workflow-found*
- `web-audit-hides-denial-reason` (S2, c=0.92): the dashboard audit log shows `denied` but never the reason /
  field / delivery mode / purpose (the `meta.reason` exists in the API — confirmed in my live audit JSON, e.g.
  `meta:{reason:"item_not_found"}` — but the web UI drops it).
- `sdk-error-no-request-id` (S2, c=0.9): `AbadgeApiError` carries no `requestId` even though the API mints and
  echoes `X-Request-Id` — integrators can't correlate a failure with server logs.

---

## 🟨 S3 — papercuts (workflow-found, verified by the workflow's adversarial pass; sampled live where noted)

**Naming / consistency**
- `json-output-shape-inconsistency` (c=0.86): `--json` shapes differ across commands (e.g. `agent add` →
  `{agent:{...}}`, `item add` → `{id,...}`) — confirmed live (my driver needed per-command JSON paths).
- `context-command-duplication` (c=0.9): `abadge use org` vs `abadge org use` (and profile) — two forms; docs
  and error hints disagree on which to use.
- `vault-password-terminology-split` (c=0.9) + `vault-jargon-vs-profile` (c=0.78): the same ZK secret is called
  "profile password", "master password", and "vault password"; "vault" and "profile" used interchangeably.
- `sdk-capability-naming-legacy-vs-canonical` (c=0.6): `permissions.create` takes `reveal_plaintext`/`mount_env`
  but every doc teaches `read`/`use` (same root as DX-001, on the SDK).
- `sdk-user-client-flat-vs-namespaced-inconsistency` (c=0.85): mixes `client.profiles.create` (namespaced) and
  `client.bootstrapProfile` (flat) for the same resource.
- `item-detail-raw-enum-badge` (S4): detail headers show `zero_knowledge`/`server_managed`; lists show friendly
  labels. (Confirmed-shaped: my `profile list --json` dumped raw enum + raw DB columns `wrappedRootKey`,
  `kdfSalt`, `kdfParams` — the CLI JSON is the raw DB row, not a clean DTO. **New: DX-S3-RAWCOLS**.)

**SDK ergonomics**
- `sdk-no-session-token-acquisition-path` (c=0.7): `AbadgeUserClient` needs a `sessionToken` but the SDK gives
  no way to obtain one (you must go outside the SDK to Better Auth or mint an `abu_` in the dashboard).
- `sdk-profiles-update-is-changepassword` (c=0.9): `client.profiles.update()` is secretly
  `changeProfilePassword()`.
- `sdk-secretvalue-exported-but-never-used` (c=0.85): `SecretValue` is a prominent export no method returns.
- `sdk-access-use-union-return-no-discriminant` (c=0.82) + `sdk-no-access-use-or-mount-example` (c=0.85): the
  mount/use→redeem path has zero runnable examples; `access.use` returns an undiscriminated union whose JSDoc
  example only type-checks for one branch.

**MCP**
- `mcp-readme-claims-kind-in-list-items` (c=0.9): claude-desktop README says `list_items` returns `kind`; it
  never does, and `docs/MCP.md` says the opposite.
- `mcp-no-profile-discovery-tool` (c=0.88): bulk mode needs a `profileId` but no tool discovers profile IDs.
- `mcp-startup-validation-only-on-config-not-key` (c=0.85): a bad `agentId`/unreadable key passes startup and
  only explodes mid-conversation on the first tool call (cryptic in Claude Desktop).
- `mcp-purpose-never-encouraged` (c=0.82): `purpose` drives the audit story but is optional and never
  encouraged, so rows come back `purpose:null` (confirmed: my live audit rows had `purpose:null`).
- `mcp-stale-run-with-secret-tools-docs-drift` (S4): `run_with_secret`/`run_with_all_secrets`/`use_secret`
  coexist in source but only `use_secret` is registered — dead tools look real.

**Web**
- `overview-access-events-24h-wrong` (c=0.95): "Access events — last 24 hours" card is capped at 5 and ignores
  the 24h window.
- `profile-keymgmt-dead-stubs` (c=0.86): vault-security actions the dashboard advertises bounce to a
  non-existent or CLI-only path.
- `bootstrap-token-no-rationale-or-recovery` (c=0.85): one-time secret panel says "won't be shown again" with
  no regenerate path.
- `personal-vs-org-onboarding-overlap` (c=0.8): "Personal account" vs "Create organization" cards describe
  near-identical capabilities.

**Docs accuracy** (`dim-docs`, all verified by workflow)
- `cli-doc-rejects-canonical-caps` (c=0.92), `cli-agent-mcp-config-undocumented` (c=0.95),
  `cli-audit-flags-undocumented` (c=0.92), `cli-json-global-flag-misdocumented` (c=0.85),
  `cli-no-multifield-items` (c=0.85), `no-cli-api-key-mint` (c=0.82), `agents-md-stale-mcp-tool-name` (S4),
  `stale-profile-create-hint` (S4, c=0.95).

**Observability**
- `cli-audit-no-filters` (c=0.9), `mcp-get-audit-no-result-filter` (c=0.9),
  `permission-denied-doesnt-name-capability` (c=0.55), `legacy-access-denied-no-meta-reason` (S4),
  `login-no-org-trap` (c=0.78), `run-flags-silently-ignored` (c=0.88), `daemon-stdio-blackhole` (S2, c=0.9),
  `daemon-discoverability-firstrun` (c=0.6).

---

## 🟦 Security-adjacent — recommend `abadge-security-audit` follow-up (NOT a DX-review verdict)

### SA-1 · `abu_` personal API keys can reveal `server_managed` plaintext via `items.ownerReveal`

**Verified facts:** `items.ownerReveal` uses `scopedSessionProcedure("items:write")` — the management tier
(`packages/trpc/src/server/routers/items.ts:694-697`); an `abu_` personal API key resolves to a session
identity `kind:"session"` (`packages/trpc/src/server/auth.ts:403,470-490`). I **live-proved** the **Better Auth
session** path: `abadge export` on a normal **team** org returned `VIA_VALUE_FLAG=x` (a revealed `server_managed`
value) with a session bearer. The **`abu_` reach is INFERRED, not live-demonstrated** — it follows from abu_→
`kind:"session"`→same `scopedSessionProcedure` tier, but I did not mint an `abu_` key and call `ownerReveal`
with it. The security audit should demonstrate the abu_ path explicitly.

**Why this is "adjacent," not a headline vuln (advisor-corrected framing):**
- It is **`server_managed` only**. The server holds those keys and can decrypt them by design; **ZK items remain
  fully protected** (`ownerReveal` early-returns on non-`server_managed`).
- AGENTS.md is **internally inconsistent**: the invariants section says abu_ keys "cannot reveal or mount secret
  values," but the auth.md section explicitly documents the abu_ session doing "personal-account owner-reveal …
  through the normal items/profiles surface" as *intended*. The code comment (`auth.ts:475`) only guarantees
  abu_ can't reach `access.*` — and `ownerReveal` lives outside `access.*`, in the items router.
- The real open question for the security audit: **is `ownerReveal` missing a personal-org gate for team orgs?**
  The docs frame owner-reveal as a personal-account affordance ("Team organizations stay in custody mode — the
  dashboard never reveals plaintext there"), but the API enforces only `storageMode`, not org type. So a team-org
  owner (or any `abu_` key scoped to that org) can reveal `server_managed` plaintext, which the "custody"
  framing implies they cannot.

**Recommendation:** reconcile the invariant wording with intent; decide whether `ownerReveal`/`export` should be
gated to personal orgs (or to owner/admin role) for team orgs; and run `abadge-security-audit` to confirm the
abu_ reach is intended. **Do not treat this DX review as the security verdict.**

---

## 🟩 SEC reframes — deliberate security invariants (surface the rationale; do NOT remove the friction)

The workflow's verify stage correctly identified these as deliberate tradeoffs and reframed them as "is the
rationale surfaced to the user at the moment they hit it?" — the right posture for a security product.

- `daemon-no-autostart-on-run` / `daemon-silent-autolock`: keep the 15-min auto-lock and the after-reboot
  password gate (Argon2id ZK boundary). Fix the *messaging*: at unlock, print "Auto-locks after 15 min idle";
  when `run`/`mount` fail with `VAULT_LOCKED`, say "Profile auto-locked — run `abadge profile unlock`" instead
  of the generic "requires the local daemon" (which misdirects a user whose daemon IS up). (`run.ts:54-63`.)
- `daemon-mcp-remediation-wrong-actor` / `mcp-zk-daemon-prereq-late-and-cross-process`: an MCP agent cannot (and
  must not) unlock a ZK profile. Retarget the hint at the human operator and offer the server-managed fallback;
  lead `examples/mcp/07-claude-desktop` with the storage-mode decision. (`resolve-secret.ts:24-30`.)
- `mcp-denied-hint-no-grant-instructions`: the agent can't grant itself; keep that. Make the denial hint name
  the actor + the copy-pasteable `abadge permission create …` command and attach `agentId`/`itemId` to the
  `ForbiddenError` meta. (`access.ts:49-62,272,421,500`.)
- `mcp-run-failure-opaque-rationale` (§RED1): keep stderr/stdout suppression. Add a static, secret-free `hint`
  to the failure result explaining output was withheld and how to inspect via `mount_secret`.
  (`run-with-secret.ts:10-11,176-180`.)
- `--value` TTY rejection (`item.ts:58-60`): **this is the model to copy** — clear rationale + exact remediation
  in one line. Use it as the bar for every SEC-friction message above.

---

## Findings the verify stage KILLED (false premises — kept for honesty)

- `export-team-org-empty` (claimed S2): premise that `ownerReveal` is gated to personal accounts is **false**;
  verify proved it gates on `storageMode` and works on team orgs — and my live run confirmed (export DID reveal
  a team-org value). The *real* issue is the inverse (SA-1 above), not "export is empty."
- `sdk-no-quickstart-or-client-init-story` (claimed S1): downgraded — an init story does exist; not S1.

---

## What live execution caught that the read-only fan-out structurally missed

Logged because it tells us where to invest review effort next time:
- **REST `/v1` 100% broken** (DX-S1-A) — invisible to code-reading; only a real HTTP call reveals it.
- **`echo -n | item add` silent no-op** (DX-S1-B) — requires actually piping stdin to a real binary.
- **Live error-string quality** — the actual messages a user sees (`"Complete onboarding"`, `"No agent
  credentials found"`, the `mount_env`-in-help vs `use`-in-docs split) only surface by running commands.

## Round-2 — execution results (main agent, live stack)

- **REST mechanism CONFIRMED** (`v1.ts:205` guard rejects function-typed caller nodes; one-line fix verified
  in-process). Folded into DX-S1-A above.
- **Blast radius CONFIRMED** — all 3 API examples route through the broken `/v1` handler (or its finale does).
- **SDK happy path WORKS end-to-end** (positive). Ran the full operator→agent flow live via `@abadge/sdk`:
  `orgs.create → profiles.list → items.create → agents.create(bootstrap) → permissions.create → agent.enroll →
  agent.connect → agent.access.read → disconnect` — every step ✓ and the agent read back the correct secret
  value. So the TypeScript SDK / CLI / web (`/trpc`) are healthy; only the REST `/v1` facade is dead.
  **Sharp asymmetry worth headlining:** the *identical* agent-access flow (challenge→sign→exchange→read) works
  via the TS SDK but is 100% dead via the documented Python/REST example (`09-agent-python`, all `/v1`). A
  TypeScript ICP succeeds on call #1; a Python ICP following the official example fails. That asymmetry *is* the
  non-TS DX gap.
- **`permissions.update()`=revoke CONFIRMED** (DX-S2-D, `client.ts:644-647`).
- **ZK-mode-unusable-from-CLI CONFIRMED and ELEVATED → DX-S2-G** (was workflow `cli-zk-profile-unbootstrappable`):
  there is no `profile bootstrap` CLI command; `profile add --storage-mode zero_knowledge` creates an
  un-bootstrapped shell (`wrappedRootKey`/`kdfSalt` null), and `profile unlock` only *unwraps an existing* key,
  so it fails. **abadge's flagship zero-knowledge differentiator cannot be initialized, unlocked, or used to
  store items from the CLI at all** — only via the web/SDK `profiles.bootstrap`. For a CLI-first developer this
  silently removes half the product. Elevate to **S2 (arguably S1 for the ZK persona)** and add a `profile
  bootstrap`/`profile init` command. Pairs with the workflow's daemon-ZK findings (the ZK story is the weakest
  surface).
- **Harness-artifact caught (NOT a finding):** my first driver's `run → "No agent credentials"` was the e2e
  `runCli` rewriting `config.json` each call, clobbering the `cli` slot that `agent add --kind local_cli` writes
  (`agent.ts:124-130`). In real use `run` reads the persisted slot. Recorded so it isn't re-reported.

**Coverage gaps (honest):** I did not live-click the web dashboard (code-read only; 10 web findings from the
fan-out stand) nor run the full ZK daemon happy path end-to-end (blocked by the no-CLI-bootstrap gap above — you
literally can't, which is itself the finding). Both are lower marginal value than the S1s already proven.

**Saturation:** two execution rounds converged. Round-1L found 2 S1s the read fan-out structurally missed;
round-2 found the SDK works (scoping, no new S1) + confirmed/elevated 2 findings. Marginal new-finding rate on
the major axes has dropped to ~0; remaining yield is S3/S4 polish. Major-finding saturation reached.

---

## Convergence tracker

| Round | Focus | New findings | Cumulative | Notes |
|-------|-------|--------------|------------|-------|
| — | setup | — | 0 | findings file created |
| 0 | calibration (capability naming) | 1 (DX-001) | 1 | method validated: exact file:line + live error |
| 1 | read fan-out (11 reviewers + verify) | 54 confirmed / 2 killed | 55 | adversarial verify killed 2 false premises, reframed 7 SEC invariants |
| 1L | live execution (main agent) | 8 live (2× S1) + SA-1 | ~63 | REST v1 100% broken, item-add stdin no-op, mcp-config dead-end, org-add no --json, ownerReveal/abu_ — none of which the read fan-out caught |
| 2 | execution (REST mechanism, SDK e2e, ZK-CLI) | 0 new S1; confirmed/elevated 3 | ~63 | REST fix verified (1 line); SDK happy path works; ZK-mode-unusable-from-CLI elevated (DX-S2-G); permissions.update=revoke confirmed; 1 harness-artifact false-positive caught |

| 3 | live MCP + REST-fix proof + web code-verify | 1 new (REST secondary defect) | ~64 | RED1 redaction VERIFIED holds; REST one-line fix PROVEN (200s) + secondary query-coercion defect found; web zk-default trap code-confirmed |

**Saturation reached on major axes.** Marginal new-finding rate ≈ 0 for S1/S2; remaining yield is S3/S4 polish.
Reproductions were run against a live wrangler-dev stack + real `@abadge/sdk` + real MCP stdio server; scratch
drivers were removed after use (the exact commands/probes are documented inline in each finding).

---

## Round-3 — MCP live + REST-fix proof + web verification

**MCP server, driven live over stdio (provisioned via SDK, agent keypair-enrolled):**
- ✅ **§RED1 redaction VERIFIED** (the headline MCP security property). `use_secret` ran a subprocess that
  `printenv`'d the injected secret to stdout; the tool response was only
  `{"exitCode":0,"durationMs":64,"outputLineCount":{"stdout":3,"stderr":0},"truncated":false}` — **the secret
  value never reached the model.** The biggest MCP risk (does redaction actually hold, or leak?) is resolved: it
  holds. This is a genuine strength — call it out, don't bury it.
- ✅ `list_items` returns metadata only, no value leak — **but confirms `mcp-readme-claims-kind-in-list-items`
  live**: the output has `id/label/storageMode/cryptoVersion/contentVersion/profileId/createdAt` and **no `kind`
  field**, contradicting the claude-desktop README.
- Permission-denied (ungranted item) returns
  `{"error":"Agent lacks 'use' permission for this item.","code":"PERMISSION_DENIED","hint":"Grant the matching
  capability on this item (or its profile) before retrying.","meta":{"itemId":"…","action":"use"}}` — better than
  the workflow implied (it *does* carry `meta.itemId`+`action`), but the hint still doesn't name the human actor
  or the exact `abadge permission create …` command (confirms the SEC-reframe `mcp-denied-hint-no-grant-instructions`).
- **No S1 in MCP** — the redaction boundary, the most load-bearing property, works.

**REST one-line fix — PROVEN end-to-end, plus a SECOND defect found** (DX-S1-A, now diagnosed+fix-proven):
applying the `v1.ts:205` guard fix (accept `"function"`) live yielded `GET /v1/items`→200, `GET /v1/agents`→200,
`GET /v1/orgs`→200, `POST /v1/items`→200 (returns the created id). **But** `GET /v1/audit?limit=3`→**400**
`"Expected number, actual \"3\""` — the REST layer's `readQueryParams` (`v1.ts:212-225`) passes query-string
values as raw strings, but Effect Schema inputs expect typed values (e.g. `limit:number`). So the one-line guard
fix restores procedure *resolution* and most routes, but endpoints with **non-string query params** (audit
`limit`/`cursor`, any paginated GET) need a **second fix: coerce numeric/boolean query params** (or relax the
input schemas to accept stringy numbers). The fix was reverted after proving it; the tree is clean.

**Web (DX-S2-E cluster) — code-verified the predicted failure; NOT live-clicked:** `create-item-panel.tsx:436`
defaults storage mode to `zero_knowledge`; submit looks up `profiles.find(p => p.storageMode === "zero_knowledge")`
(`:489`); a freshly-seeded org has only a `server_managed` default profile (confirmed live), so the first item
save fails on an empty org — `zk-storage-default-empty-org-trap` confirmed at code level. **Status caveat:** all
other web findings (`web-journey` + `dim` web items) are **code-read, not live-clicked** — treat them at lower
confidence than the live-proven CLI/API/SDK/MCP findings until someone walks the dashboard in a browser. Web
live bring-up (Next dev + separate API + browser automation) was judged heavier than its marginal value given
the fan-out + this code-verification already cover it.

