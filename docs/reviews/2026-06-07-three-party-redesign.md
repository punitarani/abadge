# abadge Three-Party Redesign — Requirements

**Date:** 2026-06-07
**Status:** Draft for review — do not implement yet
**Owners:** product + security + web
**Scope:** entire `apps/web` surface, identity/ownership model, permission semantics; downstream impact on API, SDK, CLI, MCP, daemon

---

## 1. Goals

Redesign the abadge web app around four principles:

1. **Collaborative between agent, host, and end user.** All three are first-class. Trust is split: the agent identifies *what* is acting, the host identifies *where* the action runs, the end user identifies *whose* credential is being used.
2. **Org-facing and user-facing surfaces.** The dashboard ships as two distinct apps (or two views of one) — one for organizations, one for individual users — sharing the same backend and audit log.
3. **Orgs custody users' credentials.** A B2B host org can hold an external end user's credentials in its vault, never see plaintext, and act only with that user's explicit grant.
4. **Users share credentials with agents.** An individual user can store credentials in their own vault and grant any agent — their own, an org's, or a third party's — explicit, revocable access.

Today's product partially supports principle 1 (agent + local-host daemon + implicit operator) and principle 4 (personal-account flag), but treats agent + host + user as collapsed identities, has one dashboard, and forbids cross-org grants. See §3 for what stays, §4 for what changes.

## 2. Actors

The redesign formalizes six actors. Today's code conflates several of these into "the org member" or "the agent."

| Actor | Identity today | Identity in redesign |
|---|---|---|
| **End user (Subject)** | Better Auth `user`, always a `member` of the org holding their items | Better Auth `user`, with explicit *subject* relationship to the vaults holding their credentials (own vault + N host-org subject memberships) |
| **Org operator (Custodian / Team admin)** | `member` with role `owner`/`admin` | Same, but the org's *mode* (custody vs. team) gates what they can see |
| **Org developer (Team member)** | `member` with role `member` | Same — team mode only, unchanged from today |
| **Agent** | `agents` row, `abs_` session via Ed25519 | Same, but `originOrg` (where it was registered) is decoupled from `actsForSubject` (whose credential it's using) |
| **Host** | Implicit — the local daemon, or "the API server" for remote agents | First-class `hosts` row with its own Ed25519 keypair, attested or self-asserted, optionally bound to a subject or org |
| **Agent operator** | Indistinguishable from the agent's creator (`createdBy`) | Same — the human running/maintaining the agent. Surface: agent fleet, audit, rotation |

The four-principle redesign is fundamentally about making **Subject ≠ Org** and **Host ≠ daemon-implicit** wherever it matters.

## 3. Invariants — preserved unchanged

These come straight from AGENTS.md and must not be relaxed:

- **Zero-knowledge invariant.** The server never sees plaintext or root keys for `zero_knowledge` items. KDF and unwrapping happen client-side only.
- **Server-managed plaintext.** Server-side AES-256-GCM with a single `ENCRYPTION_KEY`, key versioning, AAD binding (currently in flight — blocker B28 per `2026-04-22-production-readiness.md`).
- **No item access without an explicit (agent, item, capability) permission.**
- **Audit log is append-only, no FK constraints, logs every allowed *and* denied attempt.**
- **No wildcard permissions.**
- **0600 socket / 0600 mount files / 15-min `abs_` TTL / 60s challenge / 10-min `abe_` bootstrap.**
- **No background jobs** except the existing `RateLimitCounter` Durable Object.
- **Single Postgres source of truth**, Drizzle ORM, no raw SQL except documented.
- **Capability matrix unchanged:** `read_ciphertext`, `reveal_plaintext`, `mount_env`, `mount_file`. Same semantics; only the *who grants to whom* expands.
- **Server hold for `server_managed` is by design** — owner-reveal is allowed in vault modes that own the user identity, never in custody modes.

The redesign extends the model; it does not weaken any of the above.

## 4. Trust shape — what changes

Today's model:

```
Org ─┬─ Profile ─── Item                  Permission(agent → item, capability)
     ├─ Agent                             grants always within the same org
     └─ Member (User)                     User == Member == implicit owner
```

Redesigned model:

```
User (global identity)
  ├─ Personal vault (1:1 — owns by virtue of being the user)
  └─ Subject of N orgs (custody mode — org holds user's creds, can't reveal them)

Org (with mode = team | custody)
  ├─ team mode    → Members co-own profiles & items (today's behavior)
  └─ custody mode → Profiles & items are owned by external Subjects;
                    org operators administer policy but cannot reveal plaintext

Agent (originOrg, optional actsForSubject)
  └─ may receive grants from any vault owner (User-self or Org-as-custodian)

Host (registered, attested) ───┐
                                ├─ Three-party unwrap: secret is delivered only when
Agent (authenticated)  ────────┤   (agent ∈ grant) ∧ (host ∈ trust list) ∧ (subject consents)
                                │   — for remote/managed runtimes;
                                │   local-daemon path keeps today's two-party semantics
Subject grant     ─────────────┘
```

Key shifts:

- **Ownership is on the credential, not the container.** Items and profiles gain an `ownerSubject` (a user-id or an org-id-as-self). The container (org) is just where the row lives.
- **Subject relationships are explicit.** A `subjects` table (or extension of `member`) records "user U is a subject in org O" with state (`pending_invite`, `active`, `withdrawn`). Custody mode requires every item to point to an active subject.
- **Hosts get a registered identity.** A new `hosts` table (Ed25519 keypair, attestation metadata, last-seen) so remote-host secret injection can split trust between agent and host. Local-daemon stays as today (the daemon is the host, the user owns the machine, attestation is implicit).
- **Permissions can cross org boundaries, but only with the owner's consent.** A grant from User U's personal item to Agent A in Org O2 is allowed — it's still scoped to a single owner (U), the agent is the grantee, the org boundary is what gets explicitly relaxed at grant time.
- **Optional per-request consent.** A separate `consent_requests` table holds pending approvals when the owner has enabled "ask each use" for a sensitive item. Default off; opt-in per item.

## 5. Three deployment shapes

These are the three product shapes the redesigned web must serve cleanly. They coexist in one install — a user can be all three simultaneously.

### 5.1 Self-serve consumer
A person signs up, stores their own credentials, points agents (Claude Desktop, custom scripts, an MCP from their browser) at them. They are owner, custodian, and operator.

- **Web app:** the *user app* (§6.1). The org concept is hidden behind the word "vault."
- **Vault:** their personal vault (the user's own 1-member org under the hood, today's `metadata.type = personal` model).
- **Agents:** registered by the user, locality `local` or `remote`.
- **Trust:** two-party (user owns the machine, daemon is implicit host) for local, three-party for remote.

### 5.2 Org custody (B2B SaaS using abadge to hold customer credentials)
A SaaS product (the host org) onboards its customers. Each customer's credentials live in the org's vault but are *owned* by the customer (subject). The SaaS org's admins can grant agents but never reveal plaintext.

- **Web app for the org:** the *org-admin app* (§6.2), in custody mode.
- **Web app for the customer:** the *user app* (§6.1), with a "shared vaults" surface listing the orgs that hold credentials for them.
- **Onboarding:** the org invites a customer; the customer authenticates (or is created via auth.md anonymous-claim) and lands in their own consent + audit view.
- **Trust:** three-party always. The org acts as policy administrator; secrets unwrap only when the subject has granted the (agent × capability × optional host).

### 5.3 Org team (today's team org)
Internal team using abadge to share credentials across the org's own infrastructure. Same as today.

- **Web app for the org:** the *org-admin app* (§6.2), in team mode.
- **Subjects:** the org *is* the subject (organization-as-self).
- **Members:** can read items per role, grant agents, etc.
- **Trust:** two-party (org → agent) — the org *is* the owner.

## 6. Web app surfaces

We separate the dashboard into two apps that share the same backend. Same Next.js project; different route groups; user picks "I'm an individual" or "I'm running an organization" at first login (and can switch later — they're not mutually exclusive).

### 6.1 User app — `/u/*` (individual / subject-of-orgs)
The end user's view. The mental model is **"my credentials and what's happening to them."**

| Surface | Purpose |
|---|---|
| `/u/vault` | Personal vault — items the user owns directly. Reveal allowed. Today's `/items` for personal accounts. |
| `/u/shared` | Vaults held *for* the user by host orgs (subject-of). Each entry: which org, which items, which grants are active, current consent state. **Reveal not allowed even to the user when the org is custody-mode and the item is `zero_knowledge`** — but the user can request export of their own data on request. |
| `/u/agents` | Agents the user has registered themselves, plus pending requests from other parties' agents wanting access ("Agent X (org Y) requests `reveal_plaintext` on item Z — approve / deny"). |
| `/u/approvals` | Per-request consent inbox (for items with "ask each time" enabled). |
| `/u/audit` | Every access of every item the user *owns*, anywhere — across personal vault and all subject memberships. The single source of truth for "who used what of mine, when, on which host." |
| `/u/account` | Identity, recovery key, MFA, devices, sessions. Linked email / OAuth providers. |

Critically, the user app **does not show org-internal items the user is a *member* of but does not own** — those live in the org-admin app's team mode.

### 6.2 Org-admin app — `/o/[orgId]/*` (custodian / team admin / org developer)
The org's view. The mental model is **"my fleet of agents, my customers' (or my team's) credentials, my policies."**

| Surface | Purpose |
|---|---|
| `/o/[id]/overview` | Org dashboard: agent fleet status, recent denials, custody mode banner. |
| `/o/[id]/subjects` | **(custody mode only)** External users whose credentials we hold. Invite, deactivate, view per-subject item count + last activity. *No plaintext anywhere.* |
| `/o/[id]/profiles` | Encryption boundaries. In team mode, owned by the org. In custody mode, each profile is owned by exactly one subject and the UI groups by subject. |
| `/o/[id]/items` | Items table. Custody mode shows owner column, no reveal action. |
| `/o/[id]/agents` | Fleet management — register, bootstrap, rotate, revoke. |
| `/o/[id]/permissions` | Grants. Custody mode requires per-grant subject consent (visible status: `pending`, `granted`, `denied`); team mode is admin-self-grant as today. |
| `/o/[id]/policies` | Org-wide defaults: require per-request consent, require host attestation, max session TTL, etc. *New surface.* |
| `/o/[id]/audit` | Org-wide audit log. Custody mode shows event metadata but **not** secret payload context that would leak credential structure (e.g. field names of `zero_knowledge` items). |
| `/o/[id]/settings` | Org identity, mode (team vs. custody, set once), members & roles, billing, danger zone. |

### 6.3 Shell choices

- **Org switcher.** The top-bar switcher today flips between orgs you're a *member* of. In the redesign it also lists "My personal vault" first, then orgs you administer, then orgs you're a *subject* in (custody) — three groups, three labels.
- **Default landing.** Choose-your-mode at signup, then sticky. Recurring user: triage on `/` and route to the last context. Brand new user with one personal vault: lands at `/u/vault`. User with one custody membership: lands at `/u/shared`. Admin with one org: lands at `/o/[id]/overview`.
- **Custody mode is permanent.** Set at org creation; admin can never flip a team org to custody (membership-vs-subject semantics differ at the row level).
- **A user can be in all three buckets at once.** The org switcher must show that and never silently merge them.

### 6.4 Three-way audit views — same event, three perspectives

A single access event must be visible — with appropriate scoping — to three parties:

| Viewer | What they see |
|---|---|
| **End user** (subject) | "Agent `acme-bot` (org Acme) used my `openai_key` on host `runner-42` at 15:03 — succeeded." |
| **Org admin** (custodian) | "Agent `acme-bot` performed `reveal_plaintext` for subject `alice@…` on item `…/openai_key` from host `runner-42` — succeeded; field=`apiKey`." Plaintext payload itself is *not* shown. |
| **Agent operator** | "My agent `acme-bot` consumed secret `…/openai_key` from host `runner-42`, exit code 0, duration 240ms." No payload, no other subjects' aggregates. |

Today only the org-admin view exists. The redesign requires audit endpoints to derive each view from the same `audit_logs` row, filtered by the caller's identity.

## 7. Data model deltas

Minimal additions; we prefer extending current tables and using metadata where possible.

### 7.1 New columns
- `organization.metadata.mode`: `"personal" | "team" | "custody"` (replaces the current `type` field; `personal` becomes a kind of `team` with single member and self-owner). Personal vault stays as today's single-org-with-flag.
- `profiles.owner_subject_user_id`: nullable; when set, this profile (and its items) belongs to that user. Null = profile is owned by the org (team mode) or by the personal-vault user (personal mode).
- `items.owner_subject_user_id`: same — denormalized for query speed and per-subject filtering.
- `agents.acts_for_subject_user_id`: optional — when an agent is pinned to a single subject (common in custody mode, e.g. "this bot only ever runs for Alice").
- `permissions.granted_by_subject_user_id`: nullable; the human who granted (today's `grantedBy` works for in-org grants; this adds the cross-boundary case).

### 7.2 New tables
- `subjects` — `(organizationId, userId, state, invitedBy, invitedAt, joinedAt, withdrawnAt)`. RLS-scoped by `organizationId` like `member`. State transitions are audit-logged.
- `hosts` — `(id, organizationId | userId, name, publicKey, attestationProvider, attestationData JSONB, lastSeenAt, revokedAt)`. Owned either by an org (a registered runtime) or by a user (their machine).
- `consent_requests` — `(id, agentId, itemId, capability, requestedAt, expiresAt, decidedAt, decision, decidedByUserId)`. Expires fast (default 5 minutes). Audit-logged on both creation and decision.
- `org_grants_to_external_agent` (or extend `permissions` with `agent_origin_org_id`) — explicit record that an item-owner has granted an out-of-org agent access. Either approach is fine; pick at implementation time. The constraint is: the row must carry both `owner_subject_user_id` and `agent_origin_org_id` so cross-org grants are queryable both ways (a user can list "agents I've granted from any org" and an org can list "external grants my agent has received").

### 7.3 Schema invariants
- Every `items` row in custody mode must have a non-null `owner_subject_user_id`, and that user must be an `active` subject of the org.
- An `active` subject cannot be removed; they must `withdraw` (audit-logged, irrevocable from the org's side, recoverable only by re-invitation).
- A withdrawn subject's items are not deleted; the org-admin sees them flagged "owner withdrew" and must export-or-purge within a configurable retention window. *Open decision §10.4.*
- Custody mode invariant: `items.ownerReveal` (and `abadge export` for `server_managed`) is **gated to the subject themselves** when called against a custody-mode org. Org admins (even owners, even with `abu_` keys) cannot ownerReveal in custody mode. This finally closes SA-1 from `2026-05-30-dx-usability-review.md`. *Open decision §10.1.*

## 8. Identity / auth deltas

- **`abu_` user API keys** stay management-surface-only. They scope to a (user, org) pair already; redesign uses the same model. An `abu_` for a custody-mode org cannot do anything the user themselves couldn't (it cannot ownerReveal under custody).
- **`abs_` agent sessions** unchanged in shape; the *resolution* of which permissions an agent has now spans the agent's origin org and any explicit external-grant rows.
- **Hosts** get an Ed25519 keypair-backed session of their own, parallel to agents but separate. Reuses the same challenge/sign verification primitives in `packages/crypto` and `packages/trpc/auth.ts:60-97`. Three-party unwrap requires both an `abs_` and a `host_session` token in the request.
- **Subject identity** is just a Better Auth user — no new identity type. The user authenticates to *their* dashboard normally; their subject memberships are listed in `organizations.list` alongside `member` memberships, distinguished by relationship type.
- **auth.md anonymous-claim** keeps working and now gains a sibling flow: an org-initiated "invite a subject" path that emails an `inv_subject_…` token and lets the user accept, set a password, and immediately see the items the org has provisioned for them (without ever having seen a `clm_` style placeholder).

## 9. Non-goals (explicit)

- **No event bus, queue, or workflow infra.** Per-request consent uses synchronous polling from the user app + email/push notifications via existing channels; no Durable Object for inboxes.
- **No new crypto.** Encryption stays XChaCha20-Poly1305 (ZK) and AES-256-GCM (server-managed). No re-encryption for cross-boundary grants — the grant is an authorization record only.
- **No HSM, KMS, or external key custody.** ENCRYPTION_KEY rotation continues to be the AAD-binding migration tracked in B28.
- **No new sub-product per shape.** All three deployment shapes ship as views of the same dashboard, same API, same SDK.
- **No automatic re-issuance of secrets.** When a permission is revoked, in-flight `abs_` tokens become invalid on next refresh but extant cached values in agent memory remain — that's the agent runtime's problem, not abadge's.

## 10. Open decisions (require a call before implementing)

### 10.1 Custody mode reveal gating
The redesign locks this down: **custody-mode admins never reveal plaintext**, *even for `server_managed` items*. This contradicts the current SA-1 status (gated by `storageMode`, not org mode). Confirmation needed:

- ☐ Yes, custody mode strictly gates `items.ownerReveal` and `abadge export` by org mode. Custody owners revoke their right to read.
- ☐ No, keep `storageMode` gating; expose a separate `revealAllowed: false` flag on individual items.

**Recommendation:** option 1. The whole product promise of custody mode is "we hold it, we can't see it." `items.ownerReveal` is the only crack in that wall. Route this through `abadge-security-audit` skill before locking.

### 10.2 Personal vault: degenerate org or new entity?
Today: personal vault = 1-member org with `metadata.type = personal`. Redesign options:

- ☐ Keep as-is. Minimal schema churn. Same RLS/scoping. Just rename to "personal vault" in UI.
- ☐ Split into a `user_vaults` table. Cleaner mental model but ~6 tables of churn (profiles/items/agents/etc. need a polymorphic owner column).

**Recommendation:** keep as-is. Schema churn cost is high; mental clarity comes from UX framing, not DB shape.

### 10.3 Cross-boundary grants: v1 or v2?
Principle 4 ("users can share with other agents") implies cross-org grants. Two paths:

- ☐ **v1 scope:** user grants their item to any agent registered anywhere on the platform; org boundary is no longer a hard wall, only a default scope.
- ☐ **v2 scope:** keep org isolation hard in v1; add a separate "publish my item to org X" handshake later.

**Recommendation:** v1. The principle is a load-bearing claim; deferring it means we ship a system that contradicts principle 4. Risk: this is the single biggest security-model change and needs a security audit pass.

### 10.4 Withdrawn-subject data retention
When a subject withdraws from a custody org, what happens to their items?

- ☐ Org has N days to export-or-delete (configurable, default 30); after that, abadge auto-purges.
- ☐ Items are immediately frozen (no agent access) but retained indefinitely until org or subject deletes.
- ☐ Subject can export their own data on withdrawal; org can choose to retain ciphertext for compliance but cannot grant new agent access.

**Recommendation:** option 3. Matches GDPR-ish portability without forcing a retention policy on every host.

### 10.5 Host attestation
What attests a registered host?

- ☐ Self-asserted public key (today's agent model, copy-paste).
- ☐ Cloud provider attestation (AWS Nitro, GCP confidential, etc.).
- ☐ A trust chain rooted in the org's own signing key.

**Recommendation:** option 1 for v1, with an `attestationProvider` column ready for future expansion. Three-party trust doesn't require attestation to be cryptographically rooted; explicit subject grant is the binding security property.

## 11. Phased rollout

Each phase is independently shippable. Each ends with the app in a coherent state.

### Phase 0 — Vocabulary & nav split (1–2 weeks)
- Rename "personal account" → "personal vault" in copy
- Add `/u/*` and `/o/[id]/*` route groups; today's pages move under `/o/[id]/*`
- Org switcher gets the three-group split (personal / admin-of / subject-of) — last group empty for now
- No backend changes; this is a UX framing pass

### Phase 1 — Ownership-aware schema (2–3 weeks)
- Add `owner_subject_user_id` to `profiles` and `items` (backfill: org=self for team, user for personal)
- Add `subjects` table; backfill (each personal org gets 1 subject = the owner)
- `organization.metadata.mode` migration
- API: `items.list` & `profiles.list` filter by subject when caller is a subject (no behavior change for today's users since each profile has exactly one subject = themselves)

### Phase 2 — Custody mode (3–4 weeks)
- New custody org creation flow (org-admin app)
- Subject invitation flow (`inv_subject_…` tokens)
- User app `/u/shared` surface
- Custody-mode reveal gating (per §10.1 decision)
- Three-view audit endpoints

### Phase 3 — Cross-boundary grants & consent inbox (3–4 weeks)
- Permissions allow `agent_origin_org_id ≠ item_origin_org_id` when explicitly granted by item owner
- Consent-request flow (per-item opt-in)
- `/u/approvals` inbox
- Owner notifications (existing email channels)

### Phase 4 — Host registry (2–3 weeks)
- `hosts` table, host registration, Ed25519 challenge/sign session
- Three-party unwrap path in `access.reveal` / `access.mount` (opt-in per item via `requireHost` flag)
- Daemon stays unchanged for local-only flows

### Phase 5 — Policies & defaults (1–2 weeks)
- `/o/[id]/policies` surface
- Org-wide defaults for consent requirement, host requirement, TTLs

Total: ~12–18 weeks of focused work to fully realize the four principles. Phase 0–2 alone delivers principles 1, 2, 3; phase 3 delivers principle 4 in full.

## 12. What this document does *not* answer

- Exact wireframes / visual design (out of scope; this is requirements).
- Pricing or commercial model implications (e.g. is custody mode a paid tier?).
- Migration path for existing team orgs that semantically want custody (none yet; product is pre-revenue).
- Mobile / push notification stack for consent approvals (assumed: email + dashboard polling; revisit if usage demands).
- SDK ergonomics for cross-boundary grants (a separate `@abadge/sdk` design pass once §10.3 is settled).

## 13. References

- `AGENTS.md` — product invariants, repo map, working rules
- `docs/MOTIVATION.md` — ICPs that motivate the three-party model (browser agents, B2B SaaS, workflow agents)
- `docs/SECURITY.md` — encryption, auth, audit, capability matrix
- `docs/reviews/2026-05-30-dx-usability-review.md` §SA-1 — unresolved custody-mode reveal gating (closed by §10.1 here)
- `docs/reviews/2026-04-22-production-readiness.md` §B28 — AAD migration prerequisite to safe cross-boundary grants
- `docs/reviews/2026-04-14-full-stack-review.md` — prior architectural review baseline
- `packages/trpc/src/server/routers/access.ts` — current two-party access flow that the host extension wraps around
- `apps/web/src/lib/workspace-posture.ts` — today's personal-vs-custody banner logic; the redesigned posture lives here
