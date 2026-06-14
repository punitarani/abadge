# abadge redesign — first-principles architecture

> Status: proposal / north star. Drafted 2026-06-08.
> Scope: a ground-up rearchitecture of the abadge product and web app around a
> three-party collaboration model (agent · host · end user) and two market sides
> (org-facing custody · user-facing self-custody). Written as if abadge never
> existed, then mapped back onto the current codebase so it is actionable.
>
> When this proposal and `AGENTS.md` disagree, `AGENTS.md` is still the law of
> the current system. This document describes where we want to go and why.

---

## 0. TL;DR

abadge is an **agent credential firewall**: AI agents act *using* human and
organizational secrets without ever seeing the raw secret, under explicit,
scoped, short-lived, revocable grants, with an immutable audit trail.

The redesign reframes the product around the realisation that **every secret
access is a three-party act**, not a two-party lookup:

```
   Agent  ──acting on behalf of──▶  End user (principal / resource owner)
     │                                   │
     └────────── via ─────────▶  Host (execution context)  ◀── grants authority
```

- **End user (principal)** — the human whose credential it is. Authority flows *from* them.
- **Agent (requesting party / actor)** — has an identity, but *no inherent authority*.
- **Host (carrier / execution context)** — the laptop daemon, MCP server, or remote API surface where the secret is actually exercised. Today it is implicit. We make it **first-class and attestable**.

And it serves **two structurally-distinct, mechanically-shared sides**:

- **User-facing (self-custody)** — an individual owns their credentials and *shares scoped capabilities* with agents. They can see their own values. UX modelled on consumer item-sharing (1Password) + UMA "resource owner sets policy at the broker".
- **Org-facing (custody)** — an organization *holds credentials on behalf of* its members or its end-customers and never reveals plaintext. UX modelled on regulated custodianship (Plaid open-finance consent, HIPAA/RPA credential vaults).

The category-defining wedge stays exactly what it is today and we refuse to
dilute it: **the agent never receives the plaintext secret, and the model never
sees secret output** (`§RED1`). Everyone else delivers the secret to the
consumer; abadge brokers the *capability*, not the *secret*.

The single unifying primitive the whole product is built on:

> **Grant:** *Agent **A**, acting on behalf of principal **P**, via host **H**, may exercise capability **C** on item **I**, under constraints **K** (expiry, single-use, egress allow-list), and every attempt is audited as the full chain.*

Today abadge stores `(A, I, C)` and treats `P` as "the org" and `H` as
"whatever connected". The redesign makes `P` and `H` explicit first-class
parts of the grant and the audit row. Everything below follows from that one
move.

---

## 1. Why redesign — what the research says

Two research passes informed this (full notes summarised here):

### 1.1 The market has converged on *delegation*

The entire 2025–2026 agent-identity field agrees on one thesis: **agents act
on behalf of someone, and the job is to make that delegation explicit, scoped,
short-lived, revocable, and auditable.** Agentic-AI CVEs rose 255% YoY and
non-human identities now outnumber humans ~144:1 — almost every incident traces
to credentials that were *too broad, too long-lived, or impossible to revoke
cleanly*.

Relevant standards and the pieces abadge should adopt the *semantics* of:

| Standard | What it gives us | Adopt |
|---|---|---|
| **OAuth Token Exchange — RFC 8693** | Formal *delegation* (actor keeps its identity, explicitly *representing* the subject; composite `act` claim) vs *impersonation*; the **`may_act`** pre-authorization claim. | The act-chain vocabulary for our grant + audit model. Internally, an `abs_` session is conceptually a *delegation* token, never impersonation. |
| **UMA 2.0 (Kantara)** | Party-to-party authorization where the **resource owner sets policy centrally** and a distinct **requesting party** (an agent) gets access *without sharing credentials*. Designed for "Me-to-Bot", unlike OAuth's "Me-to-App". | The mental model for the **user-facing** side: user = resource owner, abadge = authorization server holding the policy, agent = requesting party. |
| **MCP authorization spec (2025-11)** | MCP servers are OAuth *resource servers*; Protected Resource Metadata (RFC 9728); **Resource Indicators (RFC 8707)** bind a token to one server to defeat the **confused-deputy** replay. | abadge already serves PRM + `WWW-Authenticate` (`apps/api/src/auth-md.ts`). Make `abs_` tokens **audience-bound** so a malicious MCP host can't replay them. |
| **auth.md (WorkOS, 2026)** | Open agent-registration: anonymous→claim, verified-email, ID-JAG. | Already implemented (`agent-registration.ts`). Keep tracking the `agent_auth` block. |
| **CAEP / Shared Signals** | *Real-time* revocation propagation. | Revoke must kill live sessions immediately, not at next TTL. |
| **Biscuit / macaroons** | Offline *attenuation*: a holder mints a strictly-narrower child token with no round-trip. | v2 idea: a host attenuates a broad user grant to a single-use item capability locally. Flagged, not built. |

### 1.2 Every comparable product hands the secret over — abadge doesn't

| Product | Delegation model | Lesson for abadge |
|---|---|---|
| **Infisical Agent Vault** (closest competitor) | MITM HTTPS proxy substitutes real creds into outbound requests; agent sees placeholders. `unmatched_host_policy=deny` egress filtering. | Validates the firewall thesis — but it *trusts the agent to honour `HTTPS_PROXY`*. abadge's daemon-injection + host attestation is the non-bypassable version. **Steal their egress allow-list idea.** |
| **1Password** (Service Accounts + Agentic SDK; item sharing) | Scoped per-agent keys; share a *copy* with expiry + named/verified audience; share secret never reaches their server (ZK). | Their item-sharing UX is the gold standard for our **user-facing** sharing flow. But they *give the agent the secret*; we don't. |
| **HashiCorp Vault** | Dynamic secrets with **leases** (TTL/renew/revoke); SPIFFE SVIDs. | Make grants *leased by default*. Even when custodying a static upstream secret, the downstream grant should be short-lived. |
| **AWS Secrets Manager + IAM** | No long-lived keys; `AssumeRole`→STS; **trust policies** decide who may assume, under what conditions. | The trust-policy shape — "host H may assume access for agent A on behalf of user U" — is a clean model for our three-party check. |
| **Plaid / open finance** | OAuth redirect (aggregator never sees bank password); **per-account granular consent**; revocation at account *or* item level; **1033 rule = stop using and delete on revoke**. | The blueprint for **org-facing custody on behalf of end users**: explicit consent, scoped + revocable, delete-on-revoke. |
| **HIPAA / RPA credential vaults** | Bots use a vault (never embedded secrets), minimum-necessary, RBAC, immutable audit ≥90 days, supervised credential input, distinct per-bot identity. | Confirms team-org "custody mode — never reveals plaintext" is a *market-aligned, regulation-shaped* posture, not a limitation. |
| **SPIFFE/SPIRE, Aembit, GitGuardian ($50M, 2026)** | Short-lived attested SVIDs; NHI-governance category is real and funded. | abadge's Ed25519→`abs_` is a lightweight SVID analog. The gap nobody fully solves: **host attestation** — proving the *host* is legitimate, not just the agent. That's our "what's next". |

### 1.3 Where the current code strains against the vision

From the codebase baseline (today's reality):

- The **Host is implicit.** abadge models Agent (keypair) and Org/User, but the daemon/CLI/MCP/remote host has no identity of its own. The grant cannot say "only on host H" and the audit row cannot prove where a secret was exercised.
- The **principal is flattened to "the org."** Items belong to an org. There is no first-class notion of *"this credential belongs to end-user U, the org merely custodies it, and U consented to agent A using it."* The "collaborative between agent, host, and end user" requirement has no home in the schema.
- **Permissions are `(agent, item|profile, capability)`** — no on-behalf-of principal, no host binding, no egress constraint, and expiry exists but isn't the default.
- **`items.ownerReveal` gates only on `storageMode`, not org type** (open question `§SA-1`): a *team*-org owner can reveal `server_managed` plaintext even though the dashboard frames team orgs as custody-mode "never reveals". The redesign must settle this on a principled line.
- The web IA (`Overview · Items · Agents · Profiles · Permissions · Audit · Settings`) is **resource-list shaped**, not **relationship/act shaped** — it shows lists of things, not the delegation graph that is the actual product.
- Tactical DX seams (REST `/v1` guard bug, canonical-vs-legacy capability vocab trap, piped-stdin no-op, thin error hints) — real, but symptoms, not the model. They get fixed along the way, not designed around.

---

## 2. First-principles conceptual model

### 2.1 The three roles, defined precisely

| Role | Question it answers | Identity today | Identity in redesign |
|---|---|---|---|
| **Principal** (resource owner / subject) | *On whose authority?* | implicit = org | explicit: `user`, `org`, or `subject` (end user under custody) |
| **Agent** (requesting party / actor) | *Who wants to act?* | Ed25519 keypair → `abs_` session | unchanged identity, but its session is bound to a principal + host + audience |
| **Host** (execution context / carrier) | *Where is the secret exercised?* | none (implicit) | **new**: first-class identity (keypair / attestation), kind = `local_daemon \| mcp \| remote_api`, `abh_` binding |

The **principal** is the new keystone. It has three kinds, which is exactly how
the two market sides and the org-on-behalf requirement unify:

1. **`user` principal — self-custody (user-facing).** An individual owns the
   credential. They can reveal their own values. They grant capabilities to
   agents. This is today's "personal account", generalised.
2. **`org` principal — org's own credentials (classic custody).** The
   organization owns service credentials (a shared Stripe key, a CI token). The
   org is the resource owner; custody mode applies; nobody reveals plaintext.
3. **`subject` principal — end user under org custody (the new third party).**
   An organization holds a credential *belonging to one of its end-customers*,
   who **consented**, and whose credential agents use *on that customer's
   behalf*. The customer is not a dashboard member — they get a lightweight
   consent + audit + revoke surface. This is the "orgs host users' credentials
   fully on their behalf" requirement, and it is genuinely new.

> Principal kind, not org type, is what determines reveal policy and UX posture.
> "Personal vs team org" becomes a *presentation* detail; "self-custody vs
> custody" becomes the *security* axis.

### 2.2 Entity model (target)

```
Organization (tenant + isolation boundary; personal or team — presentation only)
│
├── Member            (dashboard humans: owner/admin/member)            ── Better Auth
│
├── Principal         (resource-owner identity)  kind: user | org | subject
│     ├─ user-principal   → a Member acting for themselves (self-custody)
│     ├─ org-principal    → the organization itself (custody of its own creds)
│     └─ subject          → an end user whose creds the org custodies (NEW)
│           └── Consent   (subject ⇄ org: scope, purpose, granted/revoked, audit-view token)  (NEW)
│
├── Profile           (encryption boundary)  owned_by: Principal           ← was org-scoped only
│     └── Item         (secret)  storageMode: zero_knowledge | server_managed
│
├── Agent             (requesting party)  Ed25519 keypair → abs_ session
│
├── Host              (execution context)  kind: local_daemon | mcp | remote_api;  abh_ binding   (NEW)
│
├── Grant             (the act-chain edge — was Permission)                        (GENERALISED)
│     = (agent, target=item|profile, capability,
│        on_behalf_of=Principal, via_host=Host|HostClass|any,
│        constraints={expiresAt, singleUse, egressAllow[], purpose})
│
└── AuditLog          (append-only)  records the full chain:
        (agent, host, principal, item, capability, result, deliveryMode, egress?)
```

Changes vs today, stated as deltas (prefer deletion/generalisation over new sprawl):

- **`Permission` → `Grant`.** Add columns: `onBehalfOfPrincipalId`, `viaHostId`/`viaHostClass`, `singleUse`, `egressAllow` (jsonb), `purpose`. Existing rows migrate as `principal = org`, `host = any`, `singleUse = false`. Make `expiresAt` *default-on* in the UX (leasing).
- **`Principal`** — new thin table; for `user`/`org` it is derivable, for `subject` it is the anchor. Profiles gain `ownerPrincipalId`.
- **`Host` + host attestation/session** — new. Token prefix `abh_`. The access call carries agent token **and** host binding; grants may require a host or host-class.
- **`Subject` + `Consent`** — new, org-facing custody-on-behalf. Subject gets a magic-link/OTP portal session (not a full dashboard).
- **Audit** gains `hostId`, `principalId`, optional `egressTarget`. Still append-only, no FK.
- **`items.ownerReveal`** is re-gated on **principal kind**, not storage mode (see §6.3).

### 2.3 The capability model, generalised

Today: canonical `read`/`use` (+ legacy `read_ciphertext`, `reveal_plaintext`,
`mount_env`, `mount_file`). Keep the *delivery* capabilities; lift everything
else into **constraints** on the grant so the matrix stops being a vocab trap:

```
Grant.capability   ∈ { read_ciphertext, reveal_plaintext, mount_env, mount_file }   (delivery shape)
Grant.constraints  = {
    expiresAt:    timestamp   // leased by default
    singleUse:    bool        // burn after one access
    egressAllow:  string[]    // destination host/domain allow-list (firewall dimension)
    purpose:      string      // declared intent, surfaced in audit + consent
}
Grant.binding      = { onBehalfOf: Principal, viaHost: Host | HostClass | any }
```

The old `CAPABILITY_MATRIX` (locality × storageMode → allowed capabilities)
becomes an **access-time constraint check**, not a grant-time vocabulary gate.
Remote+ZK and remote+mount stay forbidden because they are physically
impossible (no local daemon to decrypt/inject), but the user never has to learn
two capability vocabularies. This also resolves the documented `DX-001`
canonical-vs-legacy trap by deletion.

---

## 3. The three core workflows (end to end)

These are the journeys the whole product must make obvious. Each is the same
`Grant` primitive with a different principal kind.

### 3.1 Self-custody: an individual shares a credential with an agent (user-facing)

```
1. User stores a secret in their own vault (Profile owned_by user-principal).
   - zero_knowledge: encrypted client-side; abadge never sees plaintext.
   - server_managed: abadge encrypts (AES-256-GCM); user can reveal their own value.
2. User registers / is handed an Agent (e.g. their coding agent) — keypair identity.
3. User creates a Grant in the "Access" surface:
      "Claude-on-my-laptop  may  mount_env  OPENAI_API_KEY
       on behalf of  me   via host  my-macbook-daemon
       expiring in 24h, single-use=false, egress=api.openai.com"
4. Agent on the host exchanges keypair→abs_ session (audience-bound).
5. Agent requests access; abadge checks the grant + constraints + host binding;
   the daemon injects the secret into the subprocess env. Agent never sees it;
   the model never sees output (§RED1).
6. Every attempt audited as (agent, host, me, item, mount_env, allowed).
7. User revokes from "Sharing"; the live abs_ session dies immediately (CAEP-style).
```

UX north star: **1Password item-sharing** — named recipient (agent), expiring
grant, "you grant a capability, not the secret", a visible activity feed, and
one-click revoke.

### 3.2 Custody on behalf of an end user: the new third party (org-facing)

```
1. An org (e.g. an AI customer-support company) onboards an end-customer U.
2. U consents (Plaid-style): a scoped, revocable Consent record is created —
   "Acme may custody my Zendesk token, for purpose=support-automation,
    usable by agents of class 'support-bot', revocable anytime."
   U authenticates via magic-link/OTP to a lightweight Consent Portal — NOT a
   full dashboard.
3. The credential is stored in a Profile owned_by subject-principal(U), inside
   Acme's org. Custody mode: Acme operators manage grants but NEVER see plaintext.
4. Acme grants:  "support-bot  may  reveal_plaintext  U's Zendesk token
                  on behalf of  subject(U)  via host  acme-remote-api
                  purpose=support-automation, expiring 1h, egress=acme.zendesk.com"
5. Agent acts on U's behalf; abadge enforces the grant AND the consent scope;
   plaintext is delivered to the execution path under firewall rules, never to
   the model, never to an Acme human.
6. U sees an audit feed of everything done with their credential and can revoke
   consent in one click → all grants + live sessions for U collapse (delete-on-revoke).
```

This is the literal realisation of "collaborative between agent, host, and end
user" and "orgs are able to host users' credentials fully on their behalf": the
end user stays in the loop through **consent + audit visibility + revocation**,
even though the org holds the credential and the agent exercises it.

### 3.3 Org's own service credential, used by an internal agent on a host (classic)

```
1. Org stores a shared service secret in a Profile owned_by org-principal.
2. Org registers an internal Agent and the Host(s) it runs on (e.g. CI runner,
   a named remote_api host) — hosts attest.
3. Grant: "ci-deployer  may  mount_env  DEPLOY_TOKEN  on behalf of  org
           via host-class 'github-actions', single-use, expiring 10m,
           egress=api.fly.io".
4. Access enforced; audited as the full chain; custody mode (no human reveal).
```

This is closest to today's behaviour and is the smooth migration path: existing
permissions become grants with `principal=org, host=any`.

---

## 4. Web app redesign

### 4.1 Personas → surfaces

| Persona | Today's home | New home | Notes |
|---|---|---|---|
| Individual user (self-custody) | dashboard, all 7 tabs | **slim dashboard**: Vault · Agents · Sharing · Activity · Settings | reveal own values; no member mgmt |
| Org operator / admin | dashboard, all 7 tabs | **full dashboard**: Home · Vault · Agents · **Hosts** · **Access** · **People** · Activity · Settings | custody mode; never reveals |
| End user under custody (subject) | *does not exist* | **Consent Portal** (separate minimal surface, magic-link) | consent · audit view · revoke only |
| Agent / host developer | scattered | cross-cutting **Connect** flows + docs | keypair enroll, host registration, MCP/CLI config |

### 4.2 Information architecture — from *lists of things* to *the act graph*

The core insight: the product is a **graph of who-may-do-what-with-whose-secret
-where**, so the primary surface should be that graph, not seven parallel lists.

**Org-facing dashboard (full):**

- **Home** — posture-aware overview: the act-graph at a glance (agents ⇄ items ⇄ principals ⇄ hosts), recent activity, pending consents, expiring grants, anomalies (denied attempts, off-allow-list egress).
- **Vault** — *merge today's Items + Profiles*. One surface: secrets organised by profile (encryption boundary), with storage-mode and owner-principal badges. Stop making "Profiles" a separate top-level chore.
- **Agents** — requesting parties: identity, keypair/enrollment state, last-used, which hosts they've run on, revoke.
- **Hosts** *(new)* — execution contexts: kind, attestation status, which agents run there, host-class membership, revoke. This is where the third party becomes visible.
- **Access** — *rename + reimagine "Permissions"*. The central **grant builder**: compose "Agent A · on behalf of Principal P · via Host H · capability C on Item/Profile I · constraints K". Replace the agent×item matrix with a relationship/policy view that reads like a sentence. This is the heart of the collaborative model and should be the most-polished screen.
- **People** *(new, custody orgs only)* — subjects (end users under custody): consent state, what's custodied for them, their activity, revoke-on-their-behalf. Mirrors the consent portal from the operator side.
- **Activity** — *rename "Audit"*. The full chain, filterable by **any party**: agent, host, principal, item, result, egress. Surface the *denial reason* in the UI (today it's logged but hidden — `DX-S2-F`).
- **Settings** — org/account, members, host policy (default egress, attestation requirements), API keys (`abu_`), danger zone.

**User-facing dashboard (slim):** Home · Vault · Agents · **Sharing** (the same grant builder, framed as "share access") · Activity · Settings. No Hosts tab as a chore (the daemon self-registers as "this computer"); no People tab.

**Consent Portal (subject):** a standalone minimal app — "Acme wants to use your
Zendesk login for support automation" → consent toggle, scope, an activity feed
of every use, and a prominent **Revoke** button. No vault, no agents, no
settings. Auth by magic-link/OTP.

### 4.3 Posture, unified

Today posture is keyed off `isPersonal` (org metadata) in
`apps/web/src/lib/workspace-posture.ts`. Re-key it off **principal kind /
custody mode**, which is the real axis:

| Axis | Self-custody (`user` principal) | Custody (`org` / `subject` principal) |
|---|---|---|
| Reveal own plaintext | ✅ yes (it's the user's own secret) | ❌ never (custodian-never-reveals) |
| `items.ownerReveal` / `export` | allowed | denied (settles `§SA-1` on a principled line) |
| Member management | hidden | shown (team) |
| Framing copy | "your vault, your values" | "under custody — you manage access, not values" |
| Third-party (subject) | n/a | consent + audit + revoke surfaced |

This keeps the centralised-posture pattern (one source of truth) but fixes the
open security question by construction: **custody never reveals, self-custody
reveals only your own.** A personal account is self-custody; a team org's own
secrets and any subject's secrets are custody.

---

## 5. Auth, identity & the delegation chain

### 5.1 Identity surfaces (target)

| Principal/actor | Credential | Prefix | TTL | Reaches |
|---|---|---|---|---|
| Dashboard human | Better Auth session | — | session | management surface |
| Subject (custody end user) | magic-link / OTP portal session | — | short | consent portal only (no vault/agents) |
| Personal API key | hashed key | `abu_` | long-lived | management surface only (never `access.*`) |
| Agent | Ed25519 keypair → session | `abs_` | 15 min, auto-refresh T-2m | `access.*` only, **audience-bound** |
| Agent enrollment | one-time bootstrap | `abe_` | 10 min | enrollment only |
| **Host** *(new)* | keypair / attestation → binding | `abh_` | short | binds an `abs_` access call to a host |
| Subject claim (auth.md) | one-time claim | `clm_` | 24 h | claim ceremony |

### 5.2 The access-time chain (target pipeline)

```
1. Authenticate agent          → resolve agent (abs_, hash, TTL, enabled, not revoked)
2. Verify token audience       → bound to THIS resource (RFC 8707 confused-deputy defense)
3. Verify host binding         → abh_/attestation matches grant.viaHost / host-class   (NEW)
4. Resolve principal           → grant.onBehalfOf (user | org | subject)               (NEW)
5. If subject: check Consent   → active, in-scope, purpose matches                     (NEW)
6. Resolve item (same org, not deleted) + grant (agent, item|profile, capability)
7. Check constraints           → expiry, singleUse (burn), egressAllow, purpose        (NEW dims)
8. Enforce physical constraints → remote+ZK / remote+mount impossible (was the matrix)
9. Deliver via firewall        → ZK: client/daemon decrypt; SM: server decrypt;
                                  NEVER plaintext to the model; output redacted (§RED1)
10. Audit the full chain       → (agent, host, principal, item, capability, result, egress)
```

Steps 2–5, 7 are new or newly-explicit. They are the difference between a
two-party lookup and a verifiable three-party delegation. Every audit row
becomes a complete, non-repudiable link in the chain — which also pre-empts the
**delegation-chain-splicing** weakness the IETF flagged for nested token
exchange in 2026.

### 5.3 What we deliberately do NOT build (yet)

Per the prime directives (smallest change, one obvious path, no infrastructure
without MVP need):

- **Full RFC 8693 token format / JWTs.** Adopt the *semantics* (`act` chain,
  `may_act`), keep opaque hashed tokens. No new RPC/JWT stack.
- **Biscuit/macaroon host-side attenuation** — compelling, but v2. Flag it.
- **CAEP/SSF push fabric** — start with synchronous immediate revocation
  (kill sessions on revoke); a push fabric for remote hosts is a later phase.
- **No background jobs / queues / DOs** beyond the existing `RateLimitCounter`.
  Consent-expiry and unclaimed-GC stay opportunistic, as today.
- **No HSM/KMS.** Encryption model is unchanged (ZK XChaCha20-Poly1305 +
  server-managed AES-256-GCM).

---

## 6. Security model — what changes, what is sacred

### 6.1 Invariants kept verbatim

No plaintext secret storage; no plaintext key/token storage (all hashed); no
item access without an explicit grant; no cross-org access; every allowed *and*
denied attempt audited; append-only audit with no FK; server never sees ZK
plaintext/root keys; daemon socket + mounted files 0600; short-lived agent
sessions; `{code, message, hint, meta}` error envelopes. **The agent never
receives plaintext; the model never sees secret output (`§RED1`).**

### 6.2 Invariants added

- **Leased by default.** Grants carry an expiry by default in the UX; "no
  expiry" is an explicit, flagged choice.
- **Host-bound where required.** A grant may require a specific host or
  host-class; access from an unbound host is denied + audited.
- **Egress-constrained delivery.** A grant may carry an `egressAllow` list; the
  firewall posture extends from "agent can't read the secret" to "the secret
  can only travel to these destinations" (Infisical-style, but non-bypassable
  via host enforcement).
- **Consent-gated for subjects.** A subject credential cannot be accessed
  without an active, in-scope consent; consent revoke collapses all grants +
  live sessions (delete-on-revoke, Plaid 1033 / HIPAA-aligned).
- **Audience-bound agent tokens.** `abs_` tokens are bound to a resource to
  defeat confused-deputy replay across MCP hosts.

### 6.3 The `ownerReveal` decision (`§SA-1`), settled

> **Recommendation:** Re-gate `items.ownerReveal` and `abadge export` on
> **principal kind**, not storage mode. Self-custody (`user` principal) may
> reveal its *own* `server_managed` values. Custody (`org` and `subject`
> principals) may **never** reveal plaintext — not for the org's own secrets,
> not for a subject's. This aligns abadge with the Plaid/HIPAA custodian
> posture, makes the dashboard's "custody mode never reveals" framing *true by
> construction*, and removes a real escalation path (a team-org owner reading
> server-managed plaintext).

This is the one genuinely product-level policy call in the redesign and the
codebase already flags it as a deliberate decision; the recommendation is to
take the stricter, regulation-aligned line. It should be ratified via the
`abadge-security-audit` skill rather than changed silently.

---

## 7. Mapping to the current codebase (deltas, not a rewrite)

The redesign is a *generalisation* of the current model, reachable
incrementally. Concrete deltas by package:

| Package | Change |
|---|---|
| `packages/db` | `permissions` → `grants` (add `onBehalfOfPrincipalId`, `viaHostId`/`viaHostClass`, `singleUse`, `egressAllow`, `purpose`). New tables: `principals`, `hosts`, `host_sessions`, `subjects`, `consents`. `profiles.ownerPrincipalId`. `audit_logs` += `hostId`, `principalId`, `egressTarget`. |
| `packages/core` | New types/schemas: `Principal`, `Host`, `Consent`, `Grant` (generalised `Permission`). Collapse `CAPABILITY_MATRIX` vocab into access-time constraints; keep delivery capabilities. New constants: `abh_` prefix, host kinds, consent states. |
| `packages/crypto` | Largely unchanged. Add host keypair generation/verification (reuse Ed25519 path). |
| `packages/trpc` | `permissions` router → `grants` router (principal + host + constraints). New routers: `hosts`, `subjects`, `consent`. Access pipeline gains steps 2–5,7 (§5.2). Cascades: `onHostRevoked()`, `onConsentRevoked()`, `onSubjectRemoved()`. |
| `packages/auth` | Host attestation/session issuance; subject magic-link/OTP portal sessions. Posture keyed off principal kind. |
| `packages/daemon` | Daemon self-registers as a `local_daemon` host with an identity; carries `abh_` binding on access calls. |
| `packages/mcp` | MCP server registers as an `mcp` host; ensure `abs_` audience binding. |
| `apps/web` | New IA (§4.2): merge Items+Profiles→Vault; Permissions→Access grant-builder; add Hosts, People; Audit→Activity with denial reasons; re-key `workspace-posture.ts` off custody mode. |
| `apps/web` (new app/surface) | **Consent Portal** — minimal subject app (magic-link, consent, activity, revoke). |
| Tactical fixes folded in | REST `/v1` guard (`DX-S1-A`), CLI piped-stdin (`DX-S1-B`), capability vocab trap (`DX-001`), surface-aware error hints + `requestId` (`DX-S2-F`). |
| `apps/docs` + `docs/*` | Mirror once behaviour lands; `docs/*` is source of truth, Mintlify follows. |

Migration is mechanical for existing data: every current permission becomes a
grant with `principal = org`, `host = any`, `singleUse = false`; every profile's
owner principal is the org; no subjects/consents exist until custody-on-behalf
is used.

---

## 8. Phased roadmap

1. **P0 — Foundations & honesty.** Land the tactical DX fixes (REST guard,
   piped stdin, capability vocab, error hints) and settle `ownerReveal` on the
   custody line (§6.3). Re-key posture off custody mode. *No new entities yet —
   just make the current model correct and honest.*
2. **P1 — Host as first-class.** Add `Host` identity + `abh_` binding + host
   attestation; daemon/MCP self-register; grants gain `viaHost`; audit records
   host. Adds the second of the three parties explicitly.
3. **P2 — The grant generalised.** `Permission` → `Grant` with constraints
   (lease-by-default, single-use, egress allow-list). Reimagine the web
   "Access" surface as the grant builder. The firewall gains its egress
   dimension.
4. **P3 — Custody on behalf of end users.** Add `Subject` + `Consent` +
   `on_behalf_of` principal + the Consent Portal. This completes the three-party
   model and the org-on-behalf requirement.
5. **P4 — Real-time revocation & audience binding hardening.** Immediate
   session kill on revoke; `abs_` audience binding; delete-on-revoke contract.
6. **v2 (flagged, not scheduled).** Host-side attenuation (Biscuit/macaroon),
   CAEP/SSF push to remote hosts.

Each phase is independently shippable and preserves every non-negotiable
invariant. None introduces background infrastructure beyond what exists.

---

## 9. Open decisions (need a human call)

1. **`ownerReveal` policy (`§SA-1`).** Recommendation: custody never reveals,
   self-custody reveals own (§6.3). Ratify via `abadge-security-audit`.
2. **Subject portal surface.** Separate minimal app vs a gated route in
   `apps/web`. Recommendation: a separate minimal surface so the trust boundary
   is obvious and the subject never sees operator chrome.
3. **Host attestation strength for P1.** Soft (host keypair, self-asserted kind)
   vs hard (platform attestation). Recommendation: ship soft host identity in
   P1; treat hardware attestation as v2 — it's the unsolved frontier and
   shouldn't block the model.
4. **Egress enforcement point.** Daemon-level (local) is straightforward; remote
   API hosts need cooperative enforcement. Recommendation: enforce at the daemon
   for local hosts first; document remote egress as best-effort until a push
   fabric exists.

---

## 10. One-paragraph summary

abadge becomes the **agent credential firewall for the three-party world**: an
agent, acting on behalf of a principal (a user themselves, or an org, or an end
user the org custodies with consent), via an attested host, may exercise a
scoped, leased, egress-constrained capability on a secret it never sees — and
every attempt is an auditable link in a verifiable delegation chain. The
user-facing side is consumer-grade capability sharing; the org-facing side is
regulated custodianship; both are the same `Grant` primitive underneath. We
keep the encryption model, the append-only audit, and the no-plaintext-to-model
wedge exactly as they are, and we add the two parties the current model leaves
implicit — the **host** and the **end-user principal** — because that is what
turns a vault into a firewall.
