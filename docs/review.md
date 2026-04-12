# Abadge Review

*Date: 2026-04-09 · Reviewed against main branch*

> **Evidence key**
> **Verified**: confirmed in repo code or by local command behavior during this review.
> **Inferred**: product or UX conclusion drawn from verified behavior.
> **Benchmark**: comparison based on current official docs from 1Password, Bitwarden, and Infisical.

---

## Executive Summary

### What is working

- The backend policy core is directionally strong. The API/tRPC layer cleanly enforces explicit grants, scopes access by user, blocks remote access to zero-knowledge items, and writes audit entries for allowed and denied agent access attempts. Verified in `packages/trpc/src/server/routers/access.ts`, `packages/trpc/src/server/routers/permissions.ts`, and `packages/trpc/src/server/routers/auth.ts`.
- The product already has the right primitive for local safe use: the daemon. It keeps the zero-knowledge root key local, supports env/file injection, and auto-locks. Verified in `packages/daemon/src/server.ts` and `packages/daemon/src/vault-state.ts`.
- The storage model itself is coherent at the data layer. Zero-knowledge and server-managed items are technically distinct and consistently represented in core constants, schemas, and access rules. Verified in `packages/core/src/constants.ts`, `packages/core/src/schemas.ts`, and the DB schema.
- Short-lived agent session infrastructure (bootstrap → challenge → exchange → `abs_` token) is fully implemented and working in the backend. Verified in `packages/trpc/src/server/routers/auth.ts:616-818`.

### What is broken

- The safest auth story exists in the backend, but the shipped product defaults to the weaker one. The repo fully implements keypair enrollment, challenge issuance, and short-lived `abs_` sessions, but the CLI, MCP, and web creation flows still default to long-lived legacy API keys. Verified in `packages/trpc/src/server/routers/agents.ts:39`, `packages/cli/src/commands/login.ts:247-261`, `packages/mcp/src/config.ts:29-42`, and `apps/web/src/components/dashboard/create-agent-panel.tsx:111-150`.
- MCP currently makes false security claims. `docs/SECURITY.md:207-208` states the MCP server "scans stdout/stderr and replaces the secret value with `[REDACTED]`" and "truncates to 4KB." Neither happens — `packages/mcp/src/tools/run-with-secret.ts` pipes raw output to a log file and returns the log file path to the model. `docs/flow.md:419` and `docs/abadge.md:54` repeat the same false claim. Verified in `packages/mcp/src/tools/run-with-secret.ts:15-17,64-84`.
- `use_without_reveal` is listed as a live capability in `docs/SECURITY.md:177,181`, `docs/API.md:273`, `docs/specs/DOMAIN.md:193,205,209`, `docs/specs/SDK.md:508`, `docs/entities.md:164`, and `docs/abadge.md:43`. It does not exist in `packages/core/src/constants.ts:24-29`, which defines exactly four capabilities: `read_ciphertext`, `reveal_plaintext`, `mount_env`, `mount_file`. Verified.
- MCP docs and marketing describe a keypair auth flow that does not exist in code. `docs/MCP.md:8-64`, `docs/specs/MCP.md:33-68`, and the marketing hero page (`apps/web/src/components/hero-interface-tabs.tsx:295-301`) all describe `ABADGE_AGENT_ID` + `ABADGE_PRIVATE_KEY_PATH` with a runtime challenge/session exchange. `packages/mcp/src/config.ts` reads only `ABADGE_AUTH_TOKEN`. No keypair logic exists in the MCP package. Verified.
- Fresh-checkout developer experience fails silently. `@abadge/sdk` exports only built `dist/*` artifacts (`packages/sdk/package.json:16-21`). Direct CLI or MCP runtime usage requires the SDK to have been built first. `bun packages/cli/bin/abadge.ts --help` fails on a fresh workspace until `bun run --cwd packages/sdk build` is executed. Verified by local command behavior.

### What is confusing

- Abadge currently mixes three different product stories without choosing one: local zero-knowledge secret mediation, remote automation secret retrieval, and AI-agent-safe credential use. The backend knows the difference. The surfaced interfaces blur it.
- The term "agent" hides materially different trust levels. Local CLI, local MCP, remote automation service, and hosted AI agent (Claude Code, Codex) do not deserve the same defaults or capabilities.
- Four capabilities (`read_ciphertext`, `reveal_plaintext`, `mount_env`, `mount_file`) are implementation details leaked into user-facing UX. `apps/web/src/components/dashboard/create-permission-panel.tsx:82-99` renders all four unconditionally with no filtering by agent locality or item storage mode. Verified.

### What is risky

- MCP is the biggest immediate trust risk. The product claims model-safe secret use while the actual implementation returns log file paths and temp file paths that a capable agent can likely read via filesystem access. The tool description says "never returned to the model" — the paths absolutely are. Verified in `packages/mcp/src/tools/run-with-secret.ts:84` and `packages/mcp/src/tools/mount-secret.ts:70-74`.
- CLI login silently provisions a local CLI agent and stores its long-lived API key in plaintext config at `~/.abadge/config.json` (0600). Verified in `packages/cli/src/commands/login.ts:247-261` and `packages/cli/src/config.ts:52-73`. The security posture of this file is not communicated to users.
- Docs materially overstate protections. False claims in `docs/SECURITY.md` about redaction and truncation are not cosmetic — they directly undermine trust in the security model when users or auditors discover the gap.
- The remote rate limiter is process-local. `apps/api/src/middleware/rate-limit.ts:3` is a module-level `Map`. In Cloudflare Workers each request may land in a different isolate, making this counter meaningless for distributed abuse. Verified.

### Top 5 highest-impact changes

1. **Rebuild MCP into a true brokered surface, or cut it from the launch story until it is one.** The current implementation actively misrepresents its security properties.
2. **Make short-lived session auth the default surfaced agent auth path; demote legacy API keys to explicit compatibility mode.** The stronger path is fully implemented — it just isn't surfaced.
3. **Correct the false claims in docs.** Remove all references to `use_without_reveal`, output redaction, and keypair MCP auth that don't match the code. Docs and code must agree before launch.
4. **Fix the SDK dist-only export problem.** Add a `src` export condition or drive build ordering so CLI and MCP work immediately after `bun install`.
5. **Enforce a hard split between operator and agent clients across the SDK and all internal consumers.** The personas are defined in the SDK — they just aren't used where they should be.

---

## Product Model Audit

### Is the product model coherent?

Partially.

At the storage and policy layer, yes:
- zero-knowledge means client-side encryption and local-only decryption
- server-managed means server-side encryption and optional plaintext reveal
- grants are explicit per principal, item, and capability
- audit is append-only

At the surface layer, no:
- the backend supports a stronger session-based agent model than any client actually uses
- the MCP markets non-exposure while implementing temp-file and log-path returns
- the CLI and web largely teach "make an agent, copy a key, grant access"

The core model is good. The productized model is not yet disciplined enough.

### Are zero-knowledge and server-managed modes clearly separated?

Technically: yes.

Product-wise: not enough.

- The web item-creation copy does explain the difference reasonably well. Verified in `apps/web/src/components/dashboard/create-item-panel.tsx:54-91`.
- The enforcement layer is clear: remote agents cannot access zero-knowledge items; remote agents can only get `reveal_plaintext` on server-managed items. Verified in `packages/trpc/src/server/routers/permissions.ts:66-82`.
- The problem is that the surfaces still imply a single "credential access" story. They do not make users internalize that these are fundamentally different trust models.

Abadge should stop presenting storage mode as a low-level toggle. It should present two use cases: personal or local secret (zero-knowledge, local broker only) and automation secret (server-managed, explicit automation access rules).

### Are responsibilities clear across API / SDK / CLI / MCP / web?

Not enough.

| Surface | Intended | Actual |
|---------|----------|--------|
| API/tRPC | Policy and audit authority | Correct. Clean trust-boundary enforcement. |
| SDK | Typed low-level integration plane, split by persona | Partially correct. Deprecated mixed client still in use. |
| CLI | Operator plus local broker control plane | Half operator tool, half agent bootstrap, mixed auth modes. |
| MCP | Model-facing broker front-end only | Tries to be both a model interface and a secret execution runtime — does neither fully. |
| Web | Onboarding, governance, and visibility | Correct role, but trains users into the weakest auth path. |

### Where is the current architecture fighting the product?

- The daemon exists, but MCP bypasses it for subprocess execution. CLI `run` delegates to `daemonExecEnv`; MCP `run_with_secret` spawns directly using Node.js `spawn`. Verified in `packages/cli/src/commands/run.ts:27-30` and `packages/mcp/src/tools/run-with-secret.ts:39`.
- The safer keypair-session auth exists in the backend but is not the default in any client. Verified in `packages/trpc/src/server/routers/agents.ts:39` (`authMethod ?? "legacy_api_key"`).
- The product advertises rich item kinds but execution surfaces flatten secrets into a single string or JSON blob. Verified in `packages/cli/src/secret.ts:5-23` and `packages/mcp/src/resolve-secret.ts:4-22`.

The product wants to be a firewall. Several surfaces still act like a faucet.

---

## Surface-by-Surface Review

### API (tRPC over Hono on Cloudflare Workers)

**Intended role**: Policy and audit authority. Not the primary ergonomic surface for human or model users.

**Actual current behavior**:

The API correctly enforces:
- local-only ciphertext access for zero-knowledge items
- local-only env/file mount
- remote-only plaintext reveal for server-managed items
- explicit permission checks and audit writes on every access attempt

The auth router fully implements the better future: bootstrap tokens, challenge issuance, signed session exchange, short-lived `abs_` session tokens. Verified in `packages/trpc/src/server/routers/access.ts`, `packages/trpc/src/server/routers/permissions.ts`, and `packages/trpc/src/server/routers/auth.ts:616-818`.

**DX issues**:

- Capability names are low-level and delivery-oriented. They make sense to the backend; not enough sense to operators.
- No first-class "use secret without disclosing it" contract at the API level.
- `items.resolveDisplay` exists only to solve the "items have no labels in list" problem. If items had proper metadata returned from `items.list`, this endpoint wouldn't be needed.

**Security issues**:

- `access.reveal` returns plaintext for server-managed items. Necessary sometimes, but too dangerous to be the default story for AI agents. Verified in `packages/trpc/src/server/routers/access.ts`.
- The rate limiter is process-local only (`const counters = new Map<...>()` at module scope in `apps/api/src/middleware/rate-limit.ts:3`). On Cloudflare Workers each isolate gets its own Map instance. This provides no meaningful distributed rate limiting. Verified.
- Audit metadata is too thin to explain intent. It records event type and delivery mode but not the command run, env var name, file path, host, runtime, or declared purpose.

**Simplification opportunities**:

- Define the API as a low-level substrate, not the blessed way for LLM agents to get secrets.
- Make session-based auth the documented primary path.
- Treat plaintext reveal as an advanced escape hatch, not a first-class access mode.
- Merge `items.resolveDisplay` into `items.list`.

**Recommended end-state**: API remains the policy engine. Agent auth defaults to short-lived sessions. Direct plaintext reveal available only for explicitly trusted automation clients. Distributed rate limiting for auth and access endpoints.

---

### TypeScript SDK (`packages/sdk`)

**Intended role**: Typed, boring, hard-to-misuse integration library by persona.

**Actual current behavior**:

Three classes exist:
- `AbadgeUserClient` — user session token operations (correct)
- `AbadgeAgentClient` — agent API key / session token operations (correct)
- `AbadgeClient extends AbadgeUserClient` — backwards-compatible combined client, `@deprecated`

The deprecated `AbadgeClient` is still used in MCP (`packages/mcp/src/api-client.ts:1-13`) and in the CLI (`packages/cli/src/client.ts`). The "preferred" `AbadgeAgentClient` is used nowhere in first-party production code. Verified.

The package exports only built `dist/*` with no source exports. Verified in `packages/sdk/package.json:16-21`. Direct workspace usage by CLI and MCP depends on a prior SDK build.

The `SdkTrpcClient` interface in the SDK is a manually-maintained mirror of the server router shape with an explicit comment warning about drift risk. The `public-api.typecheck.ts` file provides build-time assertions for "the most critical method signatures" only.

**DX issues**:

- The deprecated abstraction is still the one the product itself uses, defeating the purpose of the split.
- Creating a client with either a session token or agent credential from the same constructor makes wrong calls easy.
- The dist-only export means `bun packages/cli/bin/abadge.ts --help` fails on a fresh checkout until the SDK is built. Verified by local command behavior.

**Security issues**:

- Persona mixing encourages misuse. `packages/cli/src/secret.ts:46-64` tries a user endpoint first, catches `UNAUTHORIZED`, then falls back to an agent endpoint. The type system is not protecting the trust model. Verified.
- The SDK has no built-in secret masking. If a developer logs the return value of `accessReveal()`, the plaintext lands in logs with no indication it should be protected.

**Simplification opportunities**:

- Stop using `AbadgeClient` internally immediately.
- Add a source export condition (`"source": "./src/index.ts"`) or ensure workspace build orchestration so SDK consumers don't need a prior explicit build.
- Consider shipping with a `SecretString`-like opaque type that requires explicit `.expose()` to get the raw string.

**Recommended end-state**: Two classes only: `AbadgeUserClient` and `AbadgeAgentClient`. No mixed client in first-party code. Source exports for workspace use. Drift-resistant typing via generated types from the tRPC router.

---

### CLI (`packages/cli`)

**Intended role**: Best operator and local secret-execution surface in the product.

**Actual current behavior**:

The CLI serves two personas in one binary and the architecture reflects the tension.

`abadge login` has a significant hidden side effect: it auto-provisions a local CLI agent and stores its long-lived API key in `~/.abadge/config.json`. Verified in `packages/cli/src/commands/login.ts:247-261` and `packages/cli/src/config.ts:52-73`. The human bearer token is kept in daemon memory only (correct for security) but this asymmetry is undocumented to users.

The `resolveSecretValue` dual-path in `packages/cli/src/secret.ts:46-64`:

```typescript
// Tries a session endpoint first, catches 401, falls back to agent endpoint.
// Since ApiClient uses the agent key, client.getItem() always fails 401 in normal
// operation. Every abadge run makes two API calls — one guaranteed to fail.
export async function resolveSecretValue(client, itemId, mountType) {
  try {
    const item = (await client.getItem(itemId)).item;  // always 401 with agent key
    ...
  } catch (error) {
    if (!(error instanceof AbadgeApiError) || error.code !== "UNAUTHORIZED") throw error;
    return resolveMountedSecret(client, itemId, mountType);  // always runs
  }
}
```

Verified.

`docs/CLI.md:37` shows a config example with `"sessionCookie": "..."` but the actual config stores no such field — the human session is in daemon memory only. Verified.

`docs/CLI.md:133-143` says `--value` is "rejected on TTY to prevent shell history leaks; pipe from stdin instead." The code at `packages/cli/src/commands/item.ts:35-38` does `opts.value ?? (await prompt(...))` with no TTY check. The `--value` flag is accepted unconditionally. Verified.

**DX issues**:

- `abadge item list` shows ID, storage mode, crypto version, content version, created — no labels. Users can't identify which item is which.
- `abadge item create` defaults to `zero_knowledge` without explaining the agent access implications.
- All operations require UUIDs. No name-based reference (`--secret-name github-deploy-key`).
- Daemon failures surface as socket connection errors, not actionable messages.

**Security issues**:

- The CLI defaults to legacy API keys even though the backend supports keypair sessions.
- `--value` flag on `item create` accepts the secret value as a command-line argument despite docs claiming TTY rejection. Command-line arguments are typically logged in shell history and process lists. Verified in `packages/cli/src/commands/item.ts:35-38`.

**Recommended end-state**: Fix `resolveSecretValue` to always use agent endpoint directly. Make daemon failures emit actionable errors. Implement the documented TTY rejection for `--value`. Add name-based secret references. Separate operator session login from local agent bootstrap as distinct explicit steps.

---

### MCP (`packages/mcp`)

**Intended role**: Safest surface for AI-agent-driven workflows.

**Actual current behavior**:

The MCP server implements five tools: `list_items`, `run_with_secret`, `mount_secret`, `release_mount`, `get_audit`. It authenticates with a plain API key from config or env. It uses the deprecated `AbadgeClient`. It resolves secrets into plaintext strings.

`run_with_secret` (verified in `packages/mcp/src/tools/run-with-secret.ts`):
```
tool description: "Returns only the exit code and a path to the output log. The secret and command
  output are never returned to the model."
actual return:    JSON.stringify({ exitCode: result.exitCode, logFile })
```
The log file path IS returned to the model. stdout/stderr is piped directly to the log file with no scanning, redaction, or truncation. `docs/SECURITY.md:207-208`, `docs/flow.md:419`, and `docs/abadge.md:54` all claim this redaction happens. It does not. Verified.

`mount_secret` (verified in `packages/mcp/src/tools/mount-secret.ts`):
```
tool description: "Returns only the file path — never the secret content."
actual return:    JSON.stringify({ path: filePath, permissions: "0600", message: "..." })
```
The temp file path IS returned to the model. A model with filesystem or shell access can read the file within the 5-minute window. Verified.

`docs/MCP.md:8-64`, `docs/specs/MCP.md:33-68`, and `apps/web/src/components/hero-interface-tabs.tsx:295-301` all describe a keypair auth flow (`ABADGE_AGENT_ID` + `ABADGE_PRIVATE_KEY_PATH` → challenge → session exchange) that does not exist in code. `packages/mcp/src/config.ts:29-42` reads only `ABADGE_AUTH_TOKEN`. Verified.

`packages/mcp/src/resolve-secret.ts:4-22` contains a function `payloadToSecret` that is byte-for-byte identical to `packages/cli/src/secret.ts:5-23`. Verified.

`activeMounts` is a module-level `Map` in `packages/mcp/src/tools/mount-secret.ts:22-25`. Cleanup timers don't survive MCP process restarts; mounted files persist until OS cleanup. Verified.

**Critical: docs make false security claims**

The product documentation actively misleads users about security properties:

| Claim | Source | Reality |
|-------|--------|---------|
| "stdout/stderr is scanned and the secret replaced with [REDACTED]" | `docs/SECURITY.md:207` | Not implemented. Raw output piped to log. |
| "Output is truncated to 4KB" | `docs/SECURITY.md:208` | Not implemented. No truncation. |
| "Truncate to 4KB" | `docs/flow.md:419` | Not implemented. |
| "Redacts secrets from output before returning to LLM" | `docs/abadge.md:54` | Not implemented. Returns log file path. |
| MCP uses `ABADGE_AGENT_ID` + `ABADGE_PRIVATE_KEY_PATH` | `docs/MCP.md:12-13`, hero page | Not implemented. Plain API key only. |

**Recommended end-state**:

Either rebuild MCP into a true brokered surface (no path or handle returns, all subprocess execution via daemon, correct output handling) or cut it from the launch story entirely. The current implementation cannot be described as a "safe AI-agent credential surface" without false statements.

If kept: remove `mount_secret` path returns, remove `run_with_secret` log path return, delegate subprocess execution to the daemon, implement actual output scanning or do not claim it, fix auth to match the documented keypair model or update docs.

---

### Web App (`apps/web`)

**Intended role**: Operator cockpit: onboarding, vault setup, item creation, agent registration, permission management, audit review.

**Actual current behavior**:

Zero-knowledge onboarding is reactive. The vault bootstrap flow only triggers when something calls `requestUnlock()`. Verified in `apps/web/src/lib/vault-context.tsx:58-70`. There is no proactive "set up your vault" step during first login.

Item creation explains storage modes reasonably well. Verified in `apps/web/src/components/dashboard/create-item-panel.tsx:54-91`.

Agent creation defaults to `local_cli` kind and offers no public-key session option in the UI. Verified in `apps/web/src/components/dashboard/create-agent-panel.tsx:111-150`. The form calls `createAgent.mutateAsync({ name, kind, metadata })` without `authMethod`, so the backend applies the `legacy_api_key` default. Verified.

Permission creation exposes all four capabilities unconditionally. The UI renders `CAPABILITIES.map(...)` with no filtering. Invalid combinations (remote agent + ZK item, remote agent + `mount_env`) are only caught at the API layer after submission. Verified in `apps/web/src/components/dashboard/create-permission-panel.tsx:82-99`.

The `apps/web/src/components/hero-interface-tabs.tsx` marketing page shows a Claude Desktop MCP config with `ABADGE_AGENT_ID` and `ABADGE_PRIVATE_KEY_PATH` env vars at lines 295-301. This describes an unimplemented feature. Verified.

**Security issues**:

- The UI normalizes long-lived API key creation. Users following the standard flow never learn that short-lived sessions exist.
- The browser vault context has no auto-lock. The root key sits in `useState` indefinitely after unlock. Verified in `apps/web/src/lib/vault-context.tsx`. The daemon auto-locks after 15 minutes; the browser has no equivalent.
- The master password modal enforces an 8-character minimum (`minLength={8}`). With Argon2id at 64MiB/3 iterations, a common 8-character password is a realistic offline attack target if the wrapped key is ever exfiltrated from the DB.

**Simplification opportunities**:

- Replace "storage mode" as the first concept with "how will this secret be used?"
- Replace four-kind agent dropdown with local/remote binary choice.
- Filter capabilities by agent type and secret type before submission — teach via UX, not via API error.
- Add browser-side auto-lock (30 minutes of inactivity).
- Raise password minimum to 12 characters and add a strength meter.

**Recommended end-state**: Web becomes the governance and onboarding surface. It should teach the two-lane model, guide toward stronger auth, and prevent invalid configurations before they reach the API.

---

## Cross-Cutting Problems

### Naming inconsistencies

| Concept | DB | API | CLI | SDK | Docs |
|---------|----|----|-----|-----|------|
| Encrypted secret | `items` | `items` | `item` | `Item` | "item", "credential", "secret" |
| Access principal | `principals` | `agents` | `agent` | `Agent` | "agent", "principal" |
| Access grant | `grants` | `permissions` | `permission` | `Permission` | "grant", "permission" |

The user-facing vocabulary should be: **secret** (or **credential**), **agent**, **permission**. The DB can keep its names.

### Phantom capability

`use_without_reveal` appears in `docs/SECURITY.md`, `docs/API.md`, `docs/specs/DOMAIN.md`, `docs/specs/SDK.md`, `docs/entities.md`, `docs/CAPABILITY_MATRIX.md`, and `docs/abadge.md`. It does not exist in `packages/core/src/constants.ts`. `docs/CAPABILITY_MATRIX.md:20` correctly marks it as "Future" — but other docs treat it as present. Every non-"Future" reference is docs drift. Verified.

### Duplicated abstractions

- `AbadgeClient`, `AbadgeUserClient`, `AbadgeAgentClient` — three client classes where two would suffice
- `ApiClient` in CLI extends the deprecated `AbadgeClient` instead of `AbadgeAgentClient`
- `payloadToSecret` is byte-for-byte identical in `packages/cli/src/secret.ts:5-22` and `packages/mcp/src/resolve-secret.ts:4-22`. Verified.
- `SessionApiClient` in CLI is a parallel implementation of `AbadgeUserClient` with slightly different construction

### Auth and session confusion

The CLI operates in two auth contexts within the same binary — operator session (human bearer token in daemon memory) and agent context (principal API key in plaintext config). Both are needed. But they are conflated through the `resolveSecretValue` try/catch fallback, which makes a guaranteed-to-fail API call on every `abadge run`. Verified in `packages/cli/src/secret.ts:46-64`.

The MCP has a single auth context (plain API key) despite docs claiming it uses keypair sessions. Verified.

### Poor onboarding

A new user's journey:
1. Register at the web app
2. Set up vault (master password modal — reactive, triggers only when needed)
3. Create a secret — choose ZK or server-managed (explained well)
4. Register an agent — choose from 4 kinds (confusing; locality not explained)
5. Grant a permission — choose from 4 capabilities (confusing; delivery mode vs trust level mixed)
6. Configure Claude Code — follow `docs/MCP.md` which describes a flow that doesn't exist in code

Step 6 is the most critical gap: any new user trying to integrate with Claude Code will follow the documented MCP keypair setup and fail.

### Excessive setup friction

Getting a new agent access to a secret requires:
1. Create agent (web or CLI) — copy API key
2. Create permission (web or CLI) — requires knowing item UUID and choosing the right capability
3. Configure agent with API key and item UUID

Step 2 requires understanding the capability model. Step 3 requires matching API key format to agent kind. There's no wizard or guided flow. All references require UUIDs, not names.

### Unsafe defaults

- Legacy API keys are the default surfaced agent auth path in all clients
- MCP returns secret-bearing file and log handles despite claiming not to
- CLI `--value` flag accepts secrets without TTY rejection despite docs claiming otherwise
- Permission UI allows invalid combinations and teaches via post-submission errors

### Audit trail too thin for real operations

Allow/deny logging exists — that's good. But operators want to know:
- which surface was used (CLI? MCP? SDK?)
- what command was run
- which env var or file mount was involved
- what purpose the caller declared (the `purpose` field in MCP tools is never logged)
- which host or workspace made the request

Current audit metadata doesn't capture any of this. The `purpose` field in `run_with_secret` and `mount_secret` is collected, stored nowhere, and passed to nothing. Verified by searching `rg -n "purpose"` across `packages/mcp` and `packages/trpc`.

---

## Security vs Usability Analysis

### What should remain zero-knowledge only?

Master passwords, recovery keys, long-lived personal secrets, anything meant for local coding environments where the value should never transit the server decrypted. ZK items correctly enforce local-agent-only access. This restriction is right and should not be weakened.

### What can safely be server-managed?

CI/CD deploy tokens, shared automation credentials, service-to-service API keys for non-LLM workloads, credentials that must be retrievable by a remote controlled workload. Server-managed is fine when the workload itself is the trusted endpoint. It is not automatically fine when the "workload" is an autonomous LLM agent with broad tool access.

### What should never be exposed directly to an agent?

Human passwords to third-party sites, recovery material, ZK root keys, and any temp file path or log path that indirectly contains secret material.

### Where should Abadge broker access instead of returning raw secrets?

- Local coding-agent workflows: always broker
- Browser login flows: broker, require explicit approval
- MCP: broker only — return status codes and structured results, never handles

### Which interfaces should support direct retrieval vs. mediated usage?

| Interface | ZK direct retrieval | SM direct retrieval | Brokered usage | Verdict |
|-----------|---------------------|---------------------|----------------|---------|
| API | Ciphertext only to trusted local agents | Yes, for trusted non-LLM automation | Not yet | Keep low-level |
| SDK | Same as API | Same as API | Not enough | Low-level only |
| CLI | Yes, via daemon and local decrypt | Prefer daemon mediation | Yes | Best local surface |
| MCP | No | No, not to model | Yes, and only yes | Must be redesigned |
| Web | No | No | N/A | Governance surface only |

**The simplest secure product rule**: if the caller is a model, Abadge should prefer "use this secret safely" over "here is the secret."

---

## Competitive Benchmarking

### 1Password CLI / SDK

**What 1Password does better**:
- `op run` conceals subprocess-printed secrets by default and requires `--no-masking` to print them. Benchmark: [1Password secret references and `op run`](https://developer.1password.com/docs/cli/secret-references/).
- Agentic Autofill explicitly avoids handing login credentials to the AI agent and injects only the minimum credential data after approval. Benchmark: [1Password Agentic Autofill](https://developer.1password.com/docs/agentic-autofill/).
- Service accounts are explicitly scoped and auditable. Benchmark: [1Password Service Accounts](https://developer.1password.com/docs/service-accounts/).
- Name-based secret references everywhere: `op item get "GitHub Token"` — no UUID management.

**What 1Password does worse**:
- No agent-specific permission model (no "agent X can access item Y")
- No per-access audit log for agent reads
- ZK model applies to all items — no server-managed mode for hosted agent access

**What Abadge should adopt**: 1Password's "masked by default, explicit unmasking" stance for command output. 1Password's separation between service automation and AI-mediated browser use.

### Bitwarden Secrets Manager

**What Bitwarden does better**:
- Machine accounts are a first-class concept with dead-simple setup: create machine account, generate access token, done. Benchmark: [Bitwarden Machine Accounts](https://bitwarden.com/help/machine-accounts/).
- `bws run` is clearly framed as command injection with strong warnings. Benchmark: [Bitwarden Secrets Manager CLI](https://bitwarden.com/help/secrets-manager-cli/).
- Machine accounts expose event logs as part of the product mental model.

**What Bitwarden does worse**:
- No ZK separation — everything is server-side encryption
- No per-access audit log per secret
- No execution mediation

**What Abadge should adopt**: Machine account vocabulary. Event-log emphasis as a product feature, not a backend implementation detail.

### Infisical

**What Infisical does better**:
- Machine identities authenticate into short-lived access tokens. Benchmark: [Infisical Machine Identities](https://infisical.com/docs/documentation/platform/identities/machine-identities).
- `infisical run` cleanly centers secret injection. Benchmark: [Infisical CLI run](https://infisical.com/docs/cli/commands/run).

**What Abadge should adopt**: Short-lived machine identity model. `run`-first local DX. `infisical run` automatically injects all permitted secrets — no UUID-per-call required.

**What Abadge should not copy**: Auth-method sprawl. Generic secrets-platform complexity before MVP.

---

## Recommended Product Direction

### Simplest coherent product model

Abadge should be a credential access firewall with two clear lanes:

**Local/private lane**: zero-knowledge, local decrypt only, daemon-mediated CLI and MCP use, no remote plaintext access.

**Automation lane**: server-managed, explicit grants, short-lived agent sessions, direct plaintext retrieval only for trusted non-LLM automation.

### Simplest coherent surface area

| Surface | Role |
|---------|------|
| API | Low-level policy and audit plane |
| SDK | Low-level typed clients by persona |
| CLI | Best local operator and broker surface |
| MCP | Model-facing broker surface only |
| Web | Onboarding and governance |

### What to cut

- Cut MCP behaviors that return temp file paths or log file paths
- Cut legacy API key creation as the default path for local agents
- Cut all doc references to `use_without_reveal` until implemented
- Cut internal use of the compatibility `AbadgeClient`
- Cut `resolveSecretValue` try/catch fallback — go directly to agent endpoint

### What to merge

- Merge `payloadToSecret` from CLI and MCP into a shared location (`packages/core` or a new `packages/agent-utils`)
- Merge `items.resolveDisplay` into `items.list`
- Merge all local plaintext materialization through the daemon

### What to redesign

- Web agent registration and permission flows (binary local/remote choice, filtered capabilities)
- CLI login semantics (explicit, documented agent bootstrap step)
- MCP end-to-end behavior (broker only, daemon-backed execution)
- SDK packaging (source exports, no mixed client in production code)
- Rate limiting (durable / token-prefix-based for agent endpoints)

### What to delay until after MVP

- Request-time approvals for AI-agent use
- True non-reveal capabilities (browser autofill, request signing, OTP generation)
- Multi-user / organization secret sharing
- Project/folder grouping of secrets
- `use_without_reveal` (clearly mark as future everywhere and remove from live capability docs)

Ship the core safely first: local brokered use, remote automation use, explicit grants, real audit, and honest docs.

---

## Prioritized Action Plan

### P0: Critical before launch

| Problem | Why it matters | Proposed fix | Complexity |
|---------|---------------|--------------|------------|
| MCP docs and marketing make false security claims | Security product cannot make untrue statements about its security model | Remove redaction/4KB claims from SECURITY.md, flow.md, abadge.md; either implement redaction+truncation in run-with-secret.ts or remove the claim entirely; update tool description to accurately state log path is returned | Low (doc fix); Medium (implement) |
| MCP keypair auth documented and shown in hero page, not implemented | Anyone following setup docs will fail; marketing shows a broken feature | Either implement the keypair flow in packages/mcp or rewrite docs/MCP.md and update the hero page to describe what actually works | Medium |
| `use_without_reveal` listed as live capability in docs | Operators grant capabilities that don't exist | Remove from SECURITY.md, API.md, entities.md, specs/DOMAIN.md, specs/SDK.md; keep only in CAPABILITY_MATRIX.md where it is correctly marked "Future" | Low |
| SDK dist-only exports break fresh-checkout workflow | First impression is a runtime import error | Add `"source": "./src/index.ts"` export condition to packages/sdk/package.json, or add postinstall build orchestration | Low-Medium |
| `resolveSecretValue` makes guaranteed-to-fail API call on every `abadge run` | Performance + conceptual confusion; session endpoint called with agent key always 401s | Remove the try/getItem path; since ApiClient uses agent key, go directly to client.accessMount() | Low |
| Daemon failures emit socket errors, not actionable messages | New users blocked with no path forward | Catch ECONNREFUSED in daemonExecEnv/daemonDecrypt and emit: "Your vault daemon is not running. Start it with: abadge daemon start" | Low |

### P1: Important for strong MVP

| Problem | Why it matters | Proposed fix | Complexity |
|---------|---------------|--------------|------------|
| Safer session auth implemented but not surfaced | The product ships the weaker path as normal | Make public_key_session the default in web agent creation; relegate legacy_api_key to "advanced / legacy" option | Medium |
| Permission UI allows invalid combinations | Operators learn by post-submission API error | Filter capabilities by agent locality and item storage mode before submission | Low |
| Web agent creation exposes 4 kinds without explaining locality | Onboarding friction | Replace four-kind dropdown with binary local/remote choice; auto-select kind from context | Low |
| Browser vault context has no auto-lock | Root key in browser memory indefinitely | Add inactivity timeout (30 min) in vault-context.tsx that calls lockVault() | Low |
| Master password 8-character minimum | Weak for Argon2id-wrapped root key under DB-breach threat | Raise to 12 characters, add zxcvbn strength indicator | Low |
| All CLI operations require UUIDs | Friction blocks adoption; 1Password DX advantage is name-based | Add items.findByName() to API; add --secret-name flag to abadge run/mount | Medium |
| `payloadToSecret` duplicated | Divergence risk | Extract to packages/core or shared utility | Low |
| `activeMounts` doesn't survive MCP restart | Secret files orphaned on disk | On MCP startup, scan tmpdir() for abadge-* directories and clean them up | Low |
| `purpose` field collected but never used | Wasted input; unused audit metadata | Either pass purpose as meta.purpose in audit log entry, or remove the field | Low |

### P2: Valuable but later

| Problem | Why it matters | Proposed fix | Complexity |
|---------|---------------|--------------|------------|
| Fully remove AbadgeClient (deprecated) | Technical debt; three client classes confuses the product model | Migrate MCP to AbadgeAgentClient, CLI to proper split, delete AbadgeClient | Medium |
| Rate limiting is process-local | Meaningless in distributed Workers deployment | Move to Cloudflare KV or Durable Objects for distributed counting; or use token-prefix-based limits for agent endpoints | Medium |
| MCP list_items returns no labels and doesn't filter to accessible items | Agents can't discover what they have access to | New agent-scoped endpoint returning items the current agent has grants for, with labels | Medium |
| Audit entries lack action context | "Full audit trail" not operationally useful | Add surface, command, env-var name, file mount path, host, workspace metadata to access events | Medium |
| Add `--env` flag pattern for multi-secret injection | Real commands need multiple secrets | `abadge run --env "AWS_KEY=secret-name-1" --env "AWS_SECRET=secret-name-2" -- command` | Medium |
| Replace SdkTrpcClient manual mirror with generated types | Silent drift risk | Export AppRouter type from packages/trpc, use in SDK with circular-dep avoidance | High |
| Request-time approvals for AI-agent access | Some workflows need stronger human control than static grants | Requires approvals infrastructure | High |

---

## Appendix

### Verified code references

| Issue | Location |
|-------|----------|
| MCP returns logFile path to model | `packages/mcp/src/tools/run-with-secret.ts:84` |
| MCP returns temp file path to model | `packages/mcp/src/tools/mount-secret.ts:70-74` |
| MCP auth token config, no keypair support | `packages/mcp/src/config.ts:29-42` |
| MCP uses deprecated AbadgeClient | `packages/mcp/src/api-client.ts:1-13` |
| payloadToSecret duplication | `packages/cli/src/secret.ts:5-22` + `packages/mcp/src/resolve-secret.ts:4-22` |
| activeMounts restart leakage | `packages/mcp/src/tools/mount-secret.ts:22-25` |
| CLI mixed persona / dual-path fallback | `packages/cli/src/secret.ts:46-64` |
| CLI login auto-provisions agent, stores key | `packages/cli/src/commands/login.ts:247-261` |
| CLI plaintext config storage | `packages/cli/src/config.ts:52-73` |
| Backend defaults to legacy_api_key | `packages/trpc/src/server/routers/agents.ts:39` |
| Backend short-lived session auth fully implemented | `packages/trpc/src/server/routers/auth.ts:616-818` |
| Permission UI shows all capabilities unconditionally | `apps/web/src/components/dashboard/create-permission-panel.tsx:82-99` |
| Web agent creation uses legacy API key by default | `apps/web/src/components/dashboard/create-agent-panel.tsx:111-150` |
| Vault bootstrap is reactive (no proactive setup) | `apps/web/src/lib/vault-context.tsx:58-70` |
| Hero page shows non-existent keypair MCP config | `apps/web/src/components/hero-interface-tabs.tsx:295-301` |
| SDK dist-only exports, no source exports | `packages/sdk/package.json:16-21` |
| Rate limit is process-local Map | `apps/api/src/middleware/rate-limit.ts:3` |
| use_without_reveal not in code | `packages/core/src/constants.ts:24-29` |

### Verified docs drift

| Claim | Source | Reality |
|-------|--------|---------|
| "stdout/stderr scanned and replaced with [REDACTED]" | `docs/SECURITY.md:207` | Not implemented. Raw output piped to log file. |
| "Output truncated to 4KB" | `docs/SECURITY.md:208`, `docs/flow.md:419` | Not implemented. No truncation. |
| "Redacts secrets from output before returning to LLM" | `docs/abadge.md:54` | Not implemented. Returns log file path. |
| MCP uses `ABADGE_AGENT_ID` + `ABADGE_PRIVATE_KEY_PATH` | `docs/MCP.md:12-13`, `docs/specs/MCP.md:38-39`, hero page | Not implemented. Plain API key only. |
| `use_without_reveal` as live capability | `docs/SECURITY.md:177,181`, `docs/API.md:273`, `docs/specs/DOMAIN.md:193-209`, `docs/specs/SDK.md:508`, `docs/entities.md:164` | Does not exist in code. Future-only. |
| `"sessionCookie"` in CLI config | `docs/CLI.md:37` | Not stored. Human session is daemon-memory only. |
| `--value` rejected on TTY | `docs/CLI.md:133-143` | Not enforced. Code accepts --value unconditionally. |

### Token prefix cheat sheet

| Prefix | Type | TTL |
|--------|------|-----|
| `abl_` | Local agent API key | Permanent |
| `abg_` | Remote agent API key | Permanent |
| `abs_` | Agent session token | 15 minutes |
| `abe_` | Agent bootstrap token | 10 minutes |
| `abc_` | Agent challenge | 60 seconds |
| `abo_` | Operator token | Up to 30 days |

### Access path matrix

| Agent type | ZK item | Server-managed item |
|-----------|---------|---------------------|
| Local (`abl_`) | `read_ciphertext` → daemon decrypts | `reveal_plaintext`, `mount_env`, `mount_file` |
| Local session (`abs_`) | Same as above | Same as above |
| Remote (`abg_`) | **Blocked at permission creation** | `reveal_plaintext` only |

### Example minimal setup (current state)

```bash
# 1. Create a server-managed secret
abadge item create --label "github-token" --storage-mode server_managed --value "ghp_..."
# → prints UUID: <item-uuid>

# 2. Register a remote agent
abadge agent create --kind remote_agent --name "codex"
# → shows one-time API key: abg_xxxxxxxx

# 3. Grant permission (requires knowing both UUIDs)
abadge permission create --agent-id <agent-uuid> --item-id <item-uuid> --capability reveal_plaintext

# 4. Agent uses the secret
const agent = new AbadgeAgentClient({ apiUrl, apiKey: 'abg_...' })
const { payload } = await agent.accessReveal('<item-uuid>')
```

Three UUIDs to manage, one capability selection requiring docs knowledge, no name-based lookup. This is the status quo that the P0/P1 improvements address.

### Local behavior notes

- `bun install` succeeded.
- On a fresh workspace, `bun packages/cli/bin/abadge.ts --help` failed with a module resolution error until `bun run --cwd packages/sdk build` was executed. This is because `@abadge/sdk/package.json` exports only `dist/index.js` with no source fallback.
- After workspace build, CLI and MCP subcommand help worked correctly.
- `bun test` passed with 131 passing tests.
- `bun run lint` passed.
- `bun run typecheck` passed through the workspace task graph, but per-package CLI/MCP typechecks depend on SDK build order.
- Web findings are code-grounded; no full browser-authenticated app flow was run in this review pass.

### Benchmark links

- 1Password secret references and `op run` masking: [developer.1password.com/docs/cli/secret-references](https://developer.1password.com/docs/cli/secret-references/)
- 1Password service accounts: [developer.1password.com/docs/service-accounts](https://developer.1password.com/docs/service-accounts/)
- 1Password Agentic Autofill: [developer.1password.com/docs/agentic-autofill](https://developer.1password.com/docs/agentic-autofill/)
- Bitwarden Secrets Manager CLI: [bitwarden.com/help/secrets-manager-cli](https://bitwarden.com/help/secrets-manager-cli/)
- Bitwarden machine accounts: [bitwarden.com/help/machine-accounts](https://bitwarden.com/help/machine-accounts/)
- Infisical `run`: [infisical.com/docs/cli/commands/run](https://infisical.com/docs/cli/commands/run)
- Infisical machine identities: [infisical.com/docs/documentation/platform/identities/machine-identities](https://infisical.com/docs/documentation/platform/identities/machine-identities)
