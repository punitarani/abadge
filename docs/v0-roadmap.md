# Abadge v0 Implementation Roadmap

*Written: 2026-04-11 · Based on full codebase review, research docs, and follow-up design review*

---

## What We Are Building

Abadge is a **credential control plane for developers and AI agents**. The core promise: store secrets once, grant explicit per-agent access to each one, inject them into exactly the process or file that needs them, and see a full audit trail of every access — with zero-knowledge encryption for secrets that should never leave the machine.

The v0 surfaces are **API**, **CLI + daemon**, **MCP**, and **TypeScript SDK**. The web dashboard exists but is not a v0 surface priority.

---

## Why the Current Code Needs This Roadmap

Before the build plan, here is the honest assessment of what is wrong today. This is not a list of missing features — these are structural inconsistencies that make the product incomplete and in places actively misleading.

### 1. Naming is inconsistent across layers

The same concept has a different name in every layer:

| Concept | Database | API/tRPC | CLI | SDK | Docs |
|---|---|---|---|---|---|
| Stored secret | `items` | `items` | `item` | `Item` | "item", "credential", "secret" |
| Caller identity | `principals` | `agents` | `agent` | `Agent` | "agent", "principal" |
| Access grant | `grants` | `permissions` | `permission` | `Permission` | "grant", "permission" |
| Credential store | `vaults` | `vault` | `vault` | — | "vault" |

For v0, naming must be unified across every layer.

### 2. The MCP makes false security claims

The most serious problem in the codebase. The product documentation states the MCP server scans output for secrets, truncates to 4KB, never returns secret content to the model, and uses Ed25519 keypair auth. None of this is implemented. The actual MCP returns raw log file paths and temp file paths to the model, performs no output scanning, and only supports a plain API key for auth. The MCP cannot ship in this state.

### 3. Secret delivery only works for single-value items

This is the most consequential functional gap and it affects every surface. The `payloadToSecret()` helper in both CLI and MCP looks for `fields.value` on an item payload. If that is a string, delivery works. If it isn't, the helper falls back to `JSON.stringify(payload)` and injects the entire JSON blob as the "secret".

The result:

- **API keys and tokens** stored as `fields.value` → works
- **Login credentials** (`fields: { username, password }`) → injected as JSON garbage; no way to get just the password as `DB_PASSWORD`
- **Certificates** (`fields: { cert, key, chain, passphrase }`) → injected as JSON garbage; cannot be mounted as usable PEM files
- **SSH keys** (`fields: { private_key, public_key, passphrase }`) → same failure
- **Env var collections** — 5–10 related variables that logically belong together — impossible; each value needs a separate item and a separate `abadge run`

Two of the four documented item kinds are functional. Two are not. The fix is field-aware delivery; see **Secret Delivery Model** below.

### 4. There is no way to import or export secrets

Every developer Abadge is targeting has secrets in `.env` files today. Without `abadge import .env`, the product asks them to create items one at a time before they get any benefit — a larger burden than their current workflow. Without `abadge export`, there is no escape hatch. Import and export must ship in v0.

### 5. The CLI has structural problems

- On every `abadge run`, the CLI makes two API calls — the first is guaranteed to fail with a 401 because it tries the user endpoint with an agent key, catches the error, then retries with the agent endpoint. This happens on every execution.
- The `--value` flag accepts secrets as a CLI argument (shell history exposure) despite documentation claiming TTY rejection.
- `abadge item list` shows no labels — users cannot identify which item is which.
- Login silently creates a local agent and stores a long-lived API key in plaintext config. Users are not told this is happening.

### 6. The SDK has a structural problem

- The SDK exports only pre-built `dist/` artifacts. After a fresh `bun install`, `bun packages/cli/bin/abadge.ts --help` fails until the SDK is manually built first.
- The deprecated `AbadgeClient` (the mixed user+agent client) is what all internal code uses. The correctly split `AbadgeUserClient` and `AbadgeAgentClient` are unused in first-party code.

### 7. The stronger auth path exists but is never used

The backend fully implements short-lived Ed25519 keypair sessions (bootstrap → enroll → challenge → session token with 15-minute TTL). None of the clients use it by default. The CLI, MCP, and web all default to long-lived legacy API keys.

### 8. Session tokens never refresh

Agent session tokens have a 15-minute TTL, which is correct for security. The current code has no background refresh mechanism in the SDK, the CLI daemon, or the MCP. Any integration that runs longer than 15 minutes (CI/CD pipelines, dev servers, long-running agents) silently breaks mid-operation. Auto-refresh must be part of v0 on every client.

### 9. The `use_without_reveal` capability does not exist

This capability is described in six documentation files as an active feature. It is not defined in `packages/core/src/constants.ts`. The only capabilities in code are `read_ciphertext`, `reveal_plaintext`, `mount_env`, `mount_file`. Every documentation reference to `use_without_reveal` is stale.

### 10. Organizations exist but are unused

Better Auth ships with organization and member tables. They are in the database schema and referenced in session objects via `activeOrganizationId`. But no resource (items, agents, permissions) is scoped to an organization. Everything is scoped to a user. The organization layer is a stub.

### 11. Revocation and deletion have undefined cascade behavior

The code has `revokeAgent`, soft-delete on items, and (via Better Auth) member removal — but no defined rules for what happens to dependent resources. What happens to sessions when an agent is revoked? To active mounts when an item is deleted? To permissions granted by a user who leaves an org? These rules must be decided and enforced before v0. Operators will not trust revocation if its effects are ambiguous.

### 12. Error messages are not actionable

Current errors return codes like `PERMISSION_DENIED` or `INVALID_CAPABILITY` with generic messages. Developer tools live or die on what happens when something goes wrong. Every error returned from the API must include a `hint` telling the caller exactly what to do next.

---

## The New Entity Model

The v0 entity model introduces two changes from current: **Organizations** become a real first-class entity that all resources belong to, and **Profiles** replace the single-vault-per-user model with named, multi-purpose credential namespaces. Everything else is renamed for clarity and properly connected.

### Entity hierarchy

```
Organization
  ├── Members (Users with roles: owner, admin, member)
  ├── Profiles (named credential namespaces, each with ZK or shared encryption)
  │     └── Items (individual credentials, each with named fields)
  └── Agents (automated callers scoped to the org)
        └── Permissions → Items (with Capabilities)

AuditLog (append-only, org-scoped, records everything)
```

### Organization

The top-level resource owner. Everything — profiles, items, agents, permissions — belongs to an organization. A user can belong to multiple organizations. A personal workspace is an organization with one member.

Fields: `id`, `name`, `slug`, `plan`, `createdAt`, `updatedAt`
Roles: `owner`, `admin`, `member`

This entity already exists via Better Auth. What needs to be added is making all other resources org-scoped, adding role-based access control at the API layer, and exposing org management via CLI and SDK.

### Profile

A named, isolated credential namespace within an organization. Profiles replace the single "vault" per user.

A Profile is the unit of ZK encryption — each profile has its own wrapped root key, KDF salt, and KDF parameters. Unlocking a profile gives access to all items in it.

Examples: `production`, `staging`, `dev`, `personal`, `ci-cd`, `shared-secrets`.

Fields: `id`, `organizationId`, `name`, `description`, `storageMode` (default for items in this profile), `wrappedRootKey`, `kdfSalt`, `kdfParams`, `recoveryWrappedRootKey`, `keyVersion`, `createdAt`, `updatedAt`

The current `vaults` table is 1:1 with users. The new `profiles` table is many-per-org, allowing teams to have multiple named credential sets with independent encryption roots. A personal user effectively has a default profile auto-created for them.

### Item

An individual stored credential, scoped to a profile (and through it to an organization).

Items continue to support two storage modes:
- **Zero-knowledge** — encrypted client-side with XChaCha20-Poly1305
- **Server-managed** — encrypted server-side with AES-256-GCM

Fields: `id`, `profileId`, `organizationId`, `label` (**NEW — required, in the clear**), `kind`, `tags`, `storageMode`, and the existing encryption columns (`encryptedItemKey`, `ciphertext`, `contentNonce`, `serverCiphertext`, `serverIv`, `serverKeyVersion`, `cryptoVersion`, `contentVersion`, `deletedAt`, `createdAt`, `updatedAt`).

The `label` field moves into the database row (currently inside the encrypted payload, making it invisible to the list API). Users can see which item is which without decrypting.

Item payloads support **named fields**. The `fields` object inside an encrypted payload holds multiple named values — `username` and `password`, or `cert` and `key`, or any user-defined set. Individual fields can be referenced by name at delivery time. See **Secret Delivery Model** below.

### Agent

An automated caller registered within an organization.

Kinds:
- `local_cli` — running on the developer's machine via the CLI daemon
- `local_mcp` — running on the developer's machine via an MCP server
- `remote` — running in a hosted environment (CI/CD, cloud function)

Fields: `id`, `organizationId`, `name`, `description`, `kind`, `locality` (derived: `local_cli`/`local_mcp` → `local`; `remote` → `remote`), `authMethod` (`public_key_session` or `legacy_api_key`), `publicKey`, `secretHash`, `secretPrefix`, `enabled`, `revokedAt`, `lastUsedAt`, `createdAt`

The current `principals` table is renamed to `agents`, kinds simplified from four to three, and scoping changes from user to org.

### Permission

An explicit grant linking an agent to an item with a specific capability.

Fields: `id`, `organizationId`, `agentId`, `itemId`, `capability`, `expiresAt`, `grantedBy`, `createdAt`
Unique constraint: `(agentId, itemId, capability)`.

**Capabilities** (exactly four, matching current implementation):
- `read_ciphertext` — download encrypted blob; local agents only, ZK items only
- `reveal_plaintext` — decrypt and return plaintext; server-managed items
- `mount_env` — inject as environment variable into a subprocess; local agents only
- `mount_file` — write to temp file (0600 permissions); local agents only

Remove `use_without_reveal` from all documentation.

**Permissions are item-level, not field-level.** A permission grants access to the entire item payload. Field-level access is a delivery-time selection within the data the caller is already authorized to see. This keeps the authorization model simple and matches how v0 audit stores the delivered field separately from the permission check.

### Audit Log

Append-only record of every significant event. No foreign key constraints — audit entries survive entity deletion.

Fields: `id`, `organizationId`, `userId`, `agentId`, `itemId`, `profileId`, `surface` (**NEW** — `api`, `cli`, `mcp`, `sdk`), `eventType`, `result` (`allowed`, `denied`, `expired`, `revoked`, `cascade`), `deliveryMode`, `field` (**NEW** — the named field delivered, if any), `purpose` (**NEW** — caller-declared intent), `meta`, `ipAddress`, `occurredAt`

### Table rename summary

| Current | New | Change |
|---|---|---|
| `vaults` | `profiles` | Replace; many-per-org; migrate each existing vault 1:1 to a default profile in the user's personal org |
| `items` | `items` | Add `profileId`, `organizationId`, `label` (required, cleartext) |
| `principals` | `agents` | Rename; simplify kinds to three; scope to org |
| `grants` | `permissions` | Rename; scope to org |
| `auditLog` | `audit_logs` | Add `organizationId`, `profileId`, `surface`, `field`, `purpose` |
| `agentSessions` | `agent_sessions` | Re-scope to org |
| `agentSessionChallenges` | `agent_session_challenges` | Keep |
| `agentEnrollmentTokens` | `agent_enrollment_tokens` | Keep |
| `organization` | `organizations` | Keep (Better Auth) |
| `member` | `members` | Keep (Better Auth) |

---

## Secret Delivery Model

This is the core functional change that makes Abadge useful for more than API keys. Every item has a `fields` map inside its payload. Delivery can reference individual fields by name, so a single login item can inject just the password into one env var and just the username into another, and a single certificate item can mount the cert PEM to one file and the private key PEM to another.

### The resolver

A single shared helper lives in `packages/core` and replaces the duplicated `payloadToSecret` in CLI and MCP:

```typescript
export function resolveFieldValue(payload: ItemPayload, field?: string): string {
  if (field) {
    const value = payload?.fields?.[field]
    if (typeof value !== "string") {
      throw new FieldNotFoundError(field, Object.keys(payload?.fields ?? {}))
    }
    return value
  }
  // default: single-value items keep working without specifying a field
  const value = payload?.fields?.value
  if (typeof value === "string") return value
  throw new MultiFieldItemError(Object.keys(payload?.fields ?? {}))
}
```

`FieldNotFoundError` and `MultiFieldItemError` both carry a `hint` naming the available fields — see **Error Message Standards**.

**Nothing else changes.** No schema changes. No database changes. The daemon still accepts a resolved string; the fix is which string gets passed to it.

### Standard field names per kind

The `fields` object is freeform JSON and is not enforced at the database level. These are conventional names that the CLI, SDK, and MCP tools recognize. The CLI's `item create` command uses them to prompt for the right fields by kind. Any user can still store additional custom fields.

| Kind | Standard fields |
|---|---|
| `login` | `username`, `email`, `password`, `url`, `totp_secret` |
| `api_key` | `value` (default), `key_id`, `key_secret` |
| `token` | `value` |
| `certificate` | `cert`, `key`, `chain`, `passphrase` |
| `ssh_key` | `private_key`, `public_key`, `passphrase` |
| `json` | user-defined |
| `opaque` | `value` |

This table lives in `packages/core/src/constants.ts` as `STANDARD_FIELDS_BY_KIND` and is the single source of truth for interactive prompts, validation warnings, and documentation.

### Field-level delivery at the CLI

```bash
# Single-value item — backwards compatible, no --field needed
abadge run --item stripe-key --env STRIPE_KEY -- ./deploy.sh

# Inject just the password from a login item
abadge run --item prod-db --field password --env DB_PASSWORD -- ./migrate.sh

# Multiple fields from one item in a single command (stacked triples)
abadge run --item prod-db \
  --field username --env DB_USER \
  --field password --env DB_PASSWORD \
  -- ./migrate.sh

# Mount a certificate's cert and key to separate files
abadge mount --item prod-cert --field cert --file /tmp/cert.pem \
             --item prod-cert --field key  --file /tmp/cert.key \
             -- ./server

# Expand every field of a multi-field item into the environment
abadge run --item my-service-env --expand-env -- ./server
# → DATABASE_URL=..., REDIS_URL=..., API_KEY=... (field name = env var name)
```

### Field-level delivery at the MCP

```typescript
run_with_secret(itemId, command, args, purpose, field?)
mount_secret(itemId, purpose, field?)
```

`field` is optional. When omitted, the tool uses the default (`fields.value`) behavior and returns a structured `MULTI_FIELD_ITEM` error with the list of available fields if the item has no default.

### Audit implications

Every access request records the `field` that was delivered (or `"__default__"` if no field was named, or `"__expand__"` for collection expansion). This gives operators a precise answer to "who accessed the DB password?" that they cannot get today.

---

## Organization RBAC

The three roles from Better Auth (`owner`, `admin`, `member`) need concrete rules. For v0, the matrix below is enforced in API middleware on every mutating call.

| Action | Owner | Admin | Member |
|---|---|---|---|
| Manage org settings, plan, delete org | Yes | No | No |
| Invite / remove members, change roles | Yes | Yes | No |
| Create / delete profiles | Yes | Yes | No |
| Unlock / bootstrap / change password on profiles | Yes | Yes | Yes (if they have the profile password) |
| Create / update / soft-delete items | Yes | Yes | Yes (in profiles they have access to) |
| Create / revoke agents | Yes | Yes | Yes |
| Create / revoke permissions | Yes | Yes | Yes (**only on agents they created**) |
| View audit logs for any user in the org | Yes | Yes | No |
| View their own audit entries | Yes | Yes | Yes |

Two specific rules to call out:

- **Members can only grant permissions to agents they created.** This prevents a member from escalating a shared deployment agent's access. Admins and owners can grant permissions on any agent in the org.
- **Audit visibility is role-scoped.** Owners and admins see the full org log. Members see only entries where they are the actor (`userId = self`) or where they created the agent that acted.

RBAC is enforced in a single middleware (`requireRole(orgParam, minRole)`) that runs after authentication and resolves the caller's role on the requested org before the router handler executes. There is no per-router ad hoc role checking. Agent ownership is enforced by a second middleware (`requireAgentOwnership(agentIdParam)`) on `permissions.create` when the caller is a member.

---

## Cascading Behavior

Revocation and deletion must have explicit, documented effects on dependent state. Every cascade writes an audit entry with `result = "cascade"` so operators can see the downstream consequences of a single action.

### Agent revoked

- All of the agent's active `agent_sessions` are marked `revokedAt = now` immediately
- All existing permissions remain in the database (for audit) but are treated as inactive — future access attempts return `AGENT_REVOKED`
- The daemon's in-memory session cache is invalidated on the next access attempt
- One audit event per invalidated session, `eventType = "agent.revoke"`, `result = "cascade"`

### Agent rotated (public key or API key)

- Old credential material is invalidated atomically
- Permissions are unaffected (they reference the agent, not the credential)
- A single audit event records the rotation

### Item soft-deleted

- `deletedAt` is set; the `label` column is preserved so audit entries still read well
- Active file mounts of that item are released by the daemon on its next housekeeping tick (≤60 seconds)
- Subprocess executions already running with the secret injected are not interrupted (the secret is already in the process's env)
- Future access attempts return `ITEM_DELETED` — distinct from `PERMISSION_DENIED`, so operators can tell them apart
- Permissions referencing the deleted item remain in the database and show as "inactive" in listings

### Profile deleted

- A profile can only be deleted if it has no non-deleted items. The API returns a clear error listing the items that must be deleted first.
- Soft-delete on the profile itself cascades to its permissions (marked inactive) but does not touch already-soft-deleted items.

### Member removed from org

- The member loses access to all org resources immediately on the next request
- Agents they created remain in the org and are **not** auto-revoked. An owner or admin decides whether to rotate or revoke.
- Permissions they granted remain valid (the grant outlives the granter)
- The `grantedBy` field continues to reference the removed user for audit continuity
- Their audit entries are preserved

### User leaves an organization on their own

Same as "Member removed from org."

---

## Session Management and Auto-Refresh

Agent sessions have a 15-minute TTL. Every client that holds a session must refresh it before it expires. The rule for every client:

> **Start a background refresh task that re-exchanges the session when less than 2 minutes of TTL remain. If refresh fails, surface an actionable error on the next API call.**

### Where this lives

- **`AbadgeAgentClient.connect()`** — starts the refresh loop. Callers invoke `connect()` once on startup; long-running integrations (CI, dev servers) stay authenticated for their entire lifetime.
- **CLI daemon** — holds the operator's session token in memory and refreshes it the same way. If refresh fails because the underlying Better Auth session has expired, the daemon clears the session and subsequent CLI commands render `SESSION_EXPIRED` with the hint to run `abadge login`.
- **MCP server** — performs the Ed25519 session exchange on first tool call and uses the same refresh loop as `AbadgeAgentClient`.

Refresh failures name the cause (`AGENT_REVOKED`, `NETWORK_ERROR`, `SESSION_EXPIRED`) and the next action (rotate the key, retry, log in again).

### Token lifetimes (unchanged)

- Bootstrap token (`abe_`) — 10-minute TTL
- Challenge (`abc_`) — 60-second TTL
- Session token (`abs_`) — 15-minute TTL, refresh at T−2 minutes

---

## Error Message Standards

Every error returned from the API has the same shape:

```typescript
{
  code: string       // machine-readable: PERMISSION_DENIED, ITEM_DELETED, ...
  message: string    // one-line human description
  hint: string       // actionable next step, with an exact command when possible
  meta?: Record<string, unknown>  // structured context for clients to render
}
```

The CLI and MCP render the `hint` prominently. The SDK deserializes the envelope into typed `AbadgeApiError` subclasses. Every error class defined in `packages/core` requires a `hint` in its constructor — there is no path to throwing an error without one.

### Standard error codes and their hints

| Code | Message | Hint |
|---|---|---|
| `PERMISSION_DENIED` | Agent does not have capability on item | `Run: abadge permission create --agent <name> --item <label> --capability <cap>` |
| `INVALID_CAPABILITY_LOCALITY` | Capability incompatible with agent locality | `Remote agents cannot use <cap>. Use reveal_plaintext, or register a local agent.` |
| `INVALID_CAPABILITY_STORAGE` | Capability incompatible with item storage mode | `read_ciphertext requires a zero-knowledge item. Use reveal_plaintext for server-managed items.` |
| `DAEMON_NOT_RUNNING` | Local daemon is not listening | `Start it with: abadge daemon start` |
| `PROFILE_LOCKED` | Profile has no unlocked key in daemon | `Run: abadge profile unlock` |
| `SESSION_EXPIRED` | Human session has expired | `Run: abadge login` |
| `AGENT_REVOKED` | Agent is revoked | `Register a new agent: abadge agent register --name <name> --kind <kind>` |
| `ITEM_DELETED` | Item was soft-deleted | `The item "<label>" was deleted on <date>. Recreate it or restore from backup.` |
| `FIELD_NOT_FOUND` | Named field not present in item | `Available fields on "<label>": username, password. Did you mean --field password?` |
| `MULTI_FIELD_ITEM` | Item has multiple fields; none selected | `Specify --field <name>. Available: username, password.` |
| `MEMBER_INSUFFICIENT_ROLE` | Role does not permit action | `This action requires the <required> role. Ask an org owner to promote you.` |
| `MEMBER_AGENT_OWNERSHIP` | Cannot grant permissions on an agent you don't own | `Members can only grant permissions to agents they created. Ask an admin to run this command.` |
| `BOOTSTRAP_TOKEN_EXPIRED` | Enrollment token has expired | `Run: abadge agent rotate <agent-id>` to issue a fresh token |
| `PROFILE_NOT_EMPTY` | Profile still has non-deleted items | `Delete all items in the profile first: abadge item list --profile <name>` |

This is not an exhaustive list — every error in `packages/core` carries a matching hint.

---

## Import and Export

Import and export are first-class v0 features. They are the on-ramp and the escape hatch.

### `abadge import`

```bash
# Import a .env file as one item per variable
abadge import .env --profile staging

# Import with a specific kind (default: opaque)
abadge import prod.env --profile prod --kind api_key

# Grant permissions to an agent in one shot
abadge import .env --profile ci --grant-agent deploy-bot --capability mount_env

# Preview without writing
abadge import .env --profile staging --dry-run
```

Supported formats:
- `.env` — one `KEY=VALUE` per line (shell-quoted values handled)
- `.json` — flat key-value object
- `.yaml` — flat key-value mapping

Behavior:
- Each key becomes an item with `label = <KEY>` and `fields.value = <VALUE>`
- Existing items with the same label in the same profile prompt for confirmation (skip / overwrite / rename)
- Items are created in the target profile's default storage mode
- A single import creates items and permissions atomically (all-or-nothing)
- `--dry-run` prints exactly what would happen with no writes

### `abadge export`

```bash
# Write every item in a profile to a .env file
abadge export --profile staging > staging.env

# Export a subset by label pattern
abadge export --profile staging --match 'DB_*' > db.env

# Export a single multi-field item
abadge export --item prod-cert --format json > cert.json
```

Behavior:
- Requires the profile to be unlocked for ZK items (the daemon decrypts locally; no plaintext ever reaches the server)
- Requires the caller to have ownership of the items; never uses an agent session
- Every exported item is written to the audit log with `eventType = "item.export"`
- Default format is `.env` (`KEY=VALUE` lines). JSON and YAML are available via `--format`
- Multi-field items are expanded to `KEY_FIELD=VALUE` by default; `--flat` disables expansion

### What import/export do not do

- They do not sync continuously. This is a one-shot operation.
- They do not include agents, permissions, or audit logs.
- They do not cross organizations in a single call.

---

## What Each Surface Needs

### API (tRPC over Hono, Cloudflare Workers)

The API is the policy engine. Architecture is unchanged: tRPC over Hono, session + agent procedures, encryption dispatch, grant enforcement, token hashing. What changes is re-scoping to the new entity model and several new routers.

#### New routers

**`organizations`**
- `create(name, slug?)` — creates org, sets caller as owner, creates a default profile
- `list()` — orgs the user belongs to
- `get(orgId)`
- `update(orgId, { name, slug })`
- `delete(orgId)` — owner-only; rejects if org has non-deleted resources
- `members.list(orgId)`
- `members.invite(orgId, email, role)`
- `members.remove(orgId, userId)`
- `members.updateRole(orgId, userId, role)`

**`profiles`** (replaces `vault` router)
- `create(orgId, { name, description, storageMode? })`
- `list(orgId)`
- `get(profileId)` — no key material
- `bootstrap(profileId, { wrappedRootKey, kdfSalt, kdfParams })`
- `changePassword(profileId, { wrappedRootKey, kdfSalt, kdfParams })`
- `setupRecovery(profileId, { recoveryWrappedRootKey })`
- `rotateKey(profileId, { wrappedRootKey, recoveryWrappedRootKey?, rekeyedItems })`
- `delete(profileId)` — rejects with `PROFILE_NOT_EMPTY` if non-deleted items remain

#### Updated routers

**`auth`**
- `createAgent` default `authMethod` flips from `legacy_api_key` to `public_key_session`
- Legacy API keys become an explicit opt-in and return a deprecation header
- Session exchange flow (bootstrap → challenge → exchange) unchanged
- `createOperatorToken`, `listOperatorTokens`, `revokeOperatorToken` are **removed** from v0

**`items`**
- Org + profile scoping
- `label` required on create, returned on list
- `items.resolveDisplay` is **removed** — the label is in the list response

**`agents`**
- Org scoping
- `create` defaults to `public_key_session`
- `agents.self()` returns the calling agent's own record

**`permissions`**
- Org scoping
- Server validates capability against agent locality and item storage mode before insert
- Validation failures return `INVALID_CAPABILITY_LOCALITY` or `INVALID_CAPABILITY_STORAGE` with a hint

**`access`** — logic unchanged, entity names updated
- `ciphertext(itemId)` — local ZK only
- `reveal(itemId, field?)` — server-managed only; accepts optional field for delivery-time selection
- `mount(itemId, mountType, field?)` — accepts optional field for delivery-time selection

**`audit`**
- Filters: `orgId`, `profileId`, `agentId`, `itemId`, `surface`, `field`, `eventType`, `result`, cursor, limit
- Response includes the new fields

#### RBAC middleware

A single `requireRole(orgParam, minRole)` middleware is applied to every mutating router procedure. It resolves the caller's role on the org and rejects with `MEMBER_INSUFFICIENT_ROLE` if the role is below the required level. A second middleware `requireAgentOwnership(agentIdParam)` is applied to `permissions.create` when the caller is a member — rejects with `MEMBER_AGENT_OWNERSHIP` if the agent was not created by the caller.

---

### TypeScript SDK (`@abadge/sdk`)

Two clients only, types exported from source, no mixed-auth client.

#### Export fix

`packages/sdk/package.json` adds a `source` export condition so CLI and MCP can import it without a prior build:

```json
{
  "exports": {
    ".": {
      "source": "./src/index.ts",
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  }
}
```

#### `AbadgeUserClient` — session-token auth

Surface: `organizations.*`, `profiles.*`, `items.*`, `agents.*`, `permissions.*`, `audit.list`, `auth.issueBootstrapToken`.

Notes:
- `items.ownerReveal(itemId, field?)` returns a `SecretValue` for the requested field (or for `fields.value` when no field is specified)
- Every list response includes labels
- All methods return typed errors with the `{ code, message, hint }` shape

#### `AbadgeAgentClient` — keypair session auth (preferred) or legacy API key

Constructors:
- `new AbadgeAgentClient({ apiUrl, agentId, privateKey })` — keypair
- `new AbadgeAgentClient({ apiUrl, apiKey })` — legacy

Methods:
- `connect()` — performs the Ed25519 challenge/exchange and starts the background refresh loop
- `disconnect()` — stops the refresh loop
- `agents.self()`, `agents.enroll(bootstrapToken, publicKey)`
- `access.ciphertext(itemId)`, `access.reveal(itemId, field?)`, `access.mount(itemId, mountType, field?)`
- `items.list(profileId)` — metadata only
- `audit.list(orgId, filters?)`

#### `SecretValue` opaque type

```typescript
class SecretValue {
  private readonly _value: string
  expose(): string { return this._value }
  toString(): string { return "[REDACTED]" }
  toJSON(): string { return "[REDACTED]" }
}
```

Accidental logging prints `[REDACTED]`. Developers must call `.expose()` explicitly to get the raw string.

#### Removed from SDK

- `AbadgeClient` (mixed user/agent)
- `SessionApiClient` (CLI internal)
- `ApiClient` (CLI internal)

All internal consumers migrate to the two new client classes. `resolveFieldValue` is re-exported from `@abadge/sdk` for CLI and MCP convenience.

---

### CLI and Daemon

The CLI is the primary operator surface. The daemon is its execution engine.

#### Core principles

1. Always use `AbadgeUserClient` for operator commands; always `AbadgeAgentClient` for agent commands
2. Default to `public_key_session` for every agent created through the CLI
3. Never expose a secret on a command line argument without a TTY check
4. Every list command shows human-readable labels
5. Remove the dual-path `resolveSecretValue` try/catch — always call the agent endpoint directly
6. The daemon handles all ZK decryption and subprocess execution; the CLI delegates
7. Every error rendered to the terminal includes the `hint` text on a separate line below the message

#### Daemon changes

- Add operator-session auto-refresh and agent-session auto-refresh (2-minute-before-expiry rule)
- Accept `field` parameter on `item.decrypt`, `exec.env`, `exec.mount` RPCs; daemon calls `resolveFieldValue` from `@abadge/core` before injection
- Add `exec.expandEnv` RPC that reads every field from a payload and injects each as `<FIELDNAME>=<VALUE>` into the subprocess
- Housekeeping tick (≤60s) that releases mounts for items reported as deleted by the API
- Daemon socket remains 0600; mounted files remain 0600

#### Command reference

**Auth and session**
- `abadge login` — device code flow; stores session in daemon memory only; does NOT auto-provision an agent; prints explicit next steps
- `abadge logout`

**Organizations**
- `abadge org create --name <name>`
- `abadge org list`
- `abadge org use <id-or-slug>`
- `abadge org members` / `invite` / `remove` / `set-role`

**Profiles**
- `abadge profile create --name <name> [--description <desc>] [--storage-mode zk|server]`
- `abadge profile list` / `use` / `unlock` / `lock` / `status` / `change-password`

**Items**
- `abadge item create --label <name> --kind <kind> [--storage-mode <zk|server>]` — interactively prompts for the standard fields of the selected kind; `--value` only accepted when stdin is a pipe
- `abadge item list [--profile <id>] [--json]` — shows `ID | Label | Kind | Storage | Created`
- `abadge item get <id-or-label>` — name lookup supported
- `abadge item update <id-or-label>`
- `abadge item delete <id-or-label> [--force]`

**Agents**
- `abadge agent register --name <name> --kind <local_cli|local_mcp|remote> [--description <desc>]` — defaults to `public_key_session`; generates Ed25519 keypair on-device; stores private key in `~/.abadge/agents/`; uploads public key via bootstrap
- `abadge agent register --name <name> --kind remote --legacy-api-key` — opt-in; shows key once; warns
- `abadge agent list` / `get` / `rotate` / `revoke`

**Permissions**
- `abadge permission create --agent <id-or-name> --item <id-or-label> --capability <cap> [--expires-in <duration>]` — validates locally then sends; renders hint on server-side rejection
- `abadge permission list [--agent <id>] [--item <id>] [--json]`
- `abadge permission revoke <permission-id>`

**Execution (field-aware)**
- `abadge run --item <id-or-label> [--field <name>] --env <VAR> -- <command> [args...]`
- `abadge run --item <id-or-label> --expand-env -- <command> [args...]`
- `abadge run` accepts multiple `--item/--field/--env` triples on a single command
- `abadge mount --item <id-or-label> [--field <name>] --file <path> -- <command> [args...]`
- `abadge mount` accepts multiple `--item/--field/--file` triples on a single command

**Import / Export**
- `abadge import <file> --profile <name> [--kind <kind>] [--grant-agent <agent>] [--capability <cap>] [--dry-run]`
- `abadge export --profile <name> [--match <pattern>] [--format env|json|yaml] [--flat]`
- `abadge export --item <id-or-label> [--format env|json|yaml]`

**Daemon**
- `abadge daemon start` / `stop` / `status`

**Audit**
- `abadge audit list [--profile <id>] [--agent <id>] [--item <id>] [--surface <cli|mcp|api|sdk>] [--field <name>] [--json]`

#### Config file structure

```json
{
  "apiUrl": "https://api.abadge.com",
  "activeOrgId": "org_...",
  "activeProfileId": "prof_...",
  "localAgents": {
    "cli": { "agentId": "agent_...", "privateKeyPath": "~/.abadge/agents/cli.ed25519.jwk" },
    "mcp": { "agentId": "agent_...", "privateKeyPath": "~/.abadge/agents/mcp.ed25519.jwk" }
  }
}
```

No API keys stored in config. Human session lives only in daemon memory. Agent private keys live in protected files (0600).

---

### MCP

Rebuild from scratch. Every security claim the new MCP makes must match the code.

#### Authentication

On startup, the MCP reads `ABADGE_AGENT_ID` and `ABADGE_PRIVATE_KEY_PATH`. On first tool call:

1. `auth.createChallenge(agentId)` → challenge
2. Sign with Ed25519 private key
3. `auth.exchangeSession(agentId, challengeId, signature)` → `abs_` session
4. Start background refresh (T−2 min)

Legacy API keys are not supported by the MCP in v0.

#### Tools

**`list_items(profileId?)`** — returns `{ id, label, kind, storageMode, createdAt }[]`; no ciphertext, no plaintext.

**`run_with_secret(itemId, command, args, purpose, field?)`**
- Delegates to daemon `exec.env` RPC
- Daemon: session resolution → `access.mount(itemId, "env", field)` → resolve field → spawn subprocess → collect output
- Returns `{ exitCode, stdout_lines, stderr_lines, truncated }` — no raw output, no file paths, no secret material
- Output is truncated to 4KB before return and any occurrence of the secret is replaced with `[REDACTED]`
- `purpose` and `field` are logged to audit

**`mount_secret(itemId, purpose, field?)`**
- Delegates to daemon `exec.mount` RPC
- Daemon writes to a 0600 temp file, registers cleanup
- Returns `{ mountId, permissions: "0600", expiresIn: "5 minutes" }`
- `mountId` is opaque; the model cannot derive the file path
- `purpose` and `field` logged to audit

**`release_mount(mountId)`** — daemon cleanup by opaque `mountId`.

**`get_audit(filters)`** — structured audit listing, no secrets.

#### MCP config

```json
{
  "mcpServers": {
    "abadge": {
      "command": "abadge-mcp",
      "env": {
        "ABADGE_API_URL": "https://api.abadge.com",
        "ABADGE_AGENT_ID": "agent_...",
        "ABADGE_PRIVATE_KEY_PATH": "/Users/you/.abadge/agents/mcp.ed25519.jwk"
      }
    }
  }
}
```

`run_with_secret` and `mount_secret` require the local daemon (`abadge daemon start`). `list_items` and `get_audit` do not.

---

## Implementation Phases

Five phases. Each is independently completable and testable. Order reflects hard dependencies — do not parallelize across phase boundaries, but work inside a phase can run in parallel.

### Phase 1 — Foundation: data model, core contracts, shared primitives

Everything downstream depends on this phase. No surface work starts until the foundation is stable.

1. **Database schema**
   - Add `label` column to `items` (non-nullable, backfill existing rows with generated labels)
   - Rename `principals` → `agents`; simplify `kind` enum to `local_cli`, `local_mcp`, `remote`
   - Rename `grants` → `permissions`
   - Create `profiles` table; migrate each existing `vaults` row 1:1 to a default profile in the user's personal org
   - Add `organizationId` to `items`, `agents`, `permissions`, `audit_logs`
   - Add `profileId`, `surface`, `field`, `purpose` columns to `audit_logs`
   - Re-index on org-scoped query patterns

2. **`packages/core`**
   - Remove `use_without_reveal` capability
   - Remove `access.probe` event type
   - Add new agent kinds, capability-locality matrix, capability-storage matrix
   - Define `ItemPayload` type with a `fields: Record<string, unknown>` map
   - Implement `resolveFieldValue(payload, field?)` with `FieldNotFoundError` / `MultiFieldItemError`
   - Define `STANDARD_FIELDS_BY_KIND` constant map
   - Define error envelope `{ code, message, hint, meta }` and every error class with a required `hint` constructor argument
   - Define `AuditEventType` with the new event types (`item.export`, `agent.rotate`, `cascade.*`)

3. **`packages/crypto`** — no changes; audit for drift only.

4. **Drizzle schema files** updated; a single migration runs end-to-end against a production snapshot with no data loss.

5. **Delete stale code** — `vault` router scaffolding that no longer applies, `items.resolveDisplay`, operator-token procedures. `AbadgeClient` removal is deferred to Phase 3, but no new code adds consumers of it.

**Exit criteria:** all existing tests compile against the renamed schema; migrations apply cleanly against a copy of production data; `packages/core` exports `resolveFieldValue` and `STANDARD_FIELDS_BY_KIND` with passing unit tests; every error class constructs with a non-empty `hint`.

---

### Phase 2 — API: routers, RBAC, cascades, errors, audit

The API is the policy engine. Before any client is rebuilt, the server must enforce the complete v0 model.

1. **Rebuild `profiles` router** from `vault` router with multi-profile support and atomic rotation.

2. **Write `organizations` router** — CRUD + members + role management.

3. **Update `items`, `agents`, `permissions`, `access`, `audit` routers** — org + profile scoping, label required on create, capability validation with locality/storage matrices, `field` parameter on `access.reveal` and `access.mount`, new audit fields wired end-to-end.

4. **RBAC middleware** — single `requireRole(orgParam, minRole)` applied to every mutating procedure; single `requireAgentOwnership(agentIdParam)` applied to `permissions.create`. RBAC matrix from this document is the spec.

5. **Cascade enforcement** — implement as discrete functions called from each mutation:
   - `onAgentRevoked(agentId)` — invalidate sessions, emit cascade audit
   - `onItemDeleted(itemId)` — mark permissions inactive, emit cascade audit (daemon-side mount cleanup is a separate housekeeping process)
   - `onMemberRemoved(orgId, userId)` — no auto-revocation, only access loss; write the removal audit entry

6. **Error standards** — every error throw site uses the typed errors from `packages/core`. The API response serializer emits `{ code, message, hint, meta }`. A dedicated test suite asserts every documented error code has a matching hint string in the codebase.

7. **Audit writes on every surface-facing mutation** — including the new `field`, `surface`, `purpose` fields.

8. **Remove operator token endpoints** entirely.

**Exit criteria:** every endpoint in this document is implemented; RBAC matrix passes a dedicated test suite; cascade tests show sessions invalidated within 1 request of revocation; every documented error code has a test that asserts its hint text appears in the response.

---

### Phase 3 — SDK: the client library both CLI and MCP consume

Once the API is stable, rebuild the SDK before touching CLI or MCP. Both depend on it.

1. Add the `source` export condition to `packages/sdk/package.json`. A fresh `bun install && bun packages/cli/bin/abadge.ts --help` succeeds without a prior build.

2. Delete `AbadgeClient`. Every first-party consumer switches to `AbadgeUserClient` or `AbadgeAgentClient`.

3. `AbadgeUserClient` gets the full documented method surface (organizations, profiles, items, agents, permissions, audit, auth).

4. `AbadgeAgentClient` gets `connect()`, `disconnect()`, the background refresh loop, typed access methods with optional `field` parameter, and the keypair/legacy constructor overloads.

5. `SecretValue` opaque type.

6. Every response type is exported from source. Error instances are deserialized from the `{ code, message, hint, meta }` envelope into typed `AbadgeApiError` subclasses.

7. `resolveFieldValue` is re-exported from `@abadge/sdk`.

**Exit criteria:** `@abadge/sdk` is consumable from both CLI and MCP with no build step; `AbadgeAgentClient.connect()` maintains a valid session for at least one hour in a test harness; every error returned from the API surfaces its `hint` through the typed error class.

---

### Phase 4 — Clients: daemon, CLI, and MCP

The three clients share the SDK and the daemon. They are rebuilt together and can be worked in parallel inside this phase.

#### 4A — Daemon

- Operator-session auto-refresh and agent-session auto-refresh
- `field` parameter handling on `item.decrypt`, `exec.env`, `exec.mount`
- `exec.expandEnv` RPC for field-collection injection
- Housekeeping tick that releases mounts for deleted items
- Daemon socket remains 0600; mounted files remain 0600

#### 4B — CLI

- Replace `SessionApiClient` with `AbadgeUserClient`, `ApiClient` with `AbadgeAgentClient`
- Delete `resolveSecretValue` try/catch; always call the agent endpoint
- `item create --value` rejects on TTY
- `item list` shows labels
- `login` does not auto-provision an agent
- Add `org`, `profile`, rename `vault` commands
- Update `agent register` to default to `public_key_session` with on-device keypair generation
- Rewrite config loader for new file structure; provide migration from the old format
- Name/label lookup on `item get/update/delete` and `permission create`
- `--field` flag on `run` and `mount`; `--expand-env` flag on `run`; multi-item stacking
- `abadge import` and `abadge export` commands
- Error rendering — every error prints `<message>\n  hint: <hint>`

#### 4C — MCP

- Delete existing tool implementations
- Implement Ed25519 session exchange with auto-refresh using the SDK
- Rewrite `list_items`, `run_with_secret`, `mount_secret`, `release_mount`, `get_audit` — all delegating to the daemon for anything that touches plaintext
- Add `field` parameter to `run_with_secret` and `mount_secret`
- Output redaction: 4KB truncation, secret value replaced with `[REDACTED]`
- Tool descriptions match actual behavior

**Exit criteria:** every command in the CLI reference table works against a fresh profile; the MCP passes an end-to-end test that runs a command with a login item's `password` field injected as `DB_PASSWORD`; `abadge import .env --dry-run` correctly describes the import plan for a real 10-key `.env` file; every error surface renders a visible hint; `abadge agent register --kind local_cli` produces a working keypair agent without the user copying any key material.

---

### Phase 5 — Documentation and release

Only starts after all surfaces pass their acceptance tests. This phase is the final correctness pass.

1. Remove every reference to `use_without_reveal` from `docs/SECURITY.md`, `docs/specs/DOMAIN.md`, `docs/specs/SDK.md`, `docs/entities.md`, `docs/CAPABILITY_MATRIX.md`, `docs/abadge.md`
2. Remove `access.probe` event type references
3. Rewrite MCP security documentation to match the new implementation (redaction, opaque mount IDs, keypair auth)
4. Correct `docs/CLI.md` — config does not store `sessionCookie`; `--value` flag TTY behavior; full new command tree; field-level delivery examples; import/export reference
5. Rewrite `docs/ARCHITECTURE.md` to reflect Organization → Profile → Item hierarchy, cascade rules, RBAC matrix
6. Rewrite `docs/SECURITY.md` — capability matrix, session refresh model, cascade behavior, audit field list
7. Add new doc page `docs/FIELDS.md` — standard field names per kind, field-level delivery model
8. Add new doc page `docs/ERRORS.md` — every error code and its hint
9. Update `AGENTS.md` — data model summary, working rules, invariants
10. Update the hero page (`apps/web/src/components/hero-interface-tabs.tsx`) MCP config example to match keypair auth

**Exit criteria:** every documented feature is verifiable by reading the code; `grep` for `use_without_reveal` returns zero results; every error code in `docs/ERRORS.md` has an exact match in `packages/core`; every CLI command in `docs/CLI.md` has a corresponding test.

---

## What Is Intentionally Out of Scope for v0

- Operator automation tokens (session-based agent auth is the right path)
- `use_without_reveal` capability (evaluate for v1 with a concrete use case)
- Distributed rate limiting (requires Durable Objects)
- Browser auto-lock (web is not a v0 surface priority)
- Password strength enforcement upgrade (12+ char minimum targeted for v1)
- Name-based remote secret references (local lookups only for v0)
- Background job infrastructure
- Webhook or event streaming for audit events
- **Field-level permissions** (v0 permissions are item-level; field-level is a delivery selection, not an authorization boundary)
- Continuous `.env` sync (import/export are one-shot)
- Secret version history
- Item expiry tracking
- Cross-org search
- CLI distribution and install script polish
- Guided quickstart wizard

These do not make v0 broken. They are ordered candidates for v0.1.

---

## What v0 Delivers

When v0 is complete, a developer can:

1. Create an organization, invite teammates, and assign roles that actually constrain what they can do
2. Create named profiles per environment or project, each with its own ZK or server-managed root key
3. Import a `.env` file in one command to seed a profile, and export it back the same way
4. Store login credentials, API keys, tokens, certificates, SSH keys, and env collections — with field-aware delivery for multi-field secrets
5. Register agents — local CLI, local MCP, remote — defaulting to short-lived Ed25519 keypair sessions with automatic refresh that keeps long-running integrations authenticated
6. Grant explicit per-agent, per-item, per-capability permissions with server-side validation that catches incompatible combinations before they reach audit
7. Inject specific fields into specific env vars or mount them as specific files via `abadge run` and `abadge mount`
8. Use the MCP with any model — secrets never appear in tool return values, purpose is always logged, file paths stay opaque
9. See a complete audit trail: who accessed what field of what item, from which surface, for what declared purpose
10. Get clear, actionable errors on every failure — every error says what went wrong AND what to do next
11. Revoke an agent, delete an item, or remove a member and have the cascade behavior be predictable and logged

Every claim the product makes about security matches the code.
