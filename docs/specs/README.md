# Technical Specifications

> Foundational reference for the abadge control plane.
> These specs define the canonical interfaces across all surfaces.

## What is abadge?

abadge is a credential control plane for AI agents and developers. It solves three problems:

1. **Secret storage** — A zero-knowledge vault where developers store secrets that only they can decrypt, plus a server-managed mode for secrets that need to be accessed by remote agents.

2. **Agent access control** — A capability-based permission system that lets users register agents (CI runners, MCP servers, local tools) and grant them scoped access to specific secrets with specific delivery modes.

3. **Auditability** — An append-only audit trail that logs every access attempt (allowed and denied) with the agent, item, capability, and outcome.

---

## How to Read These Specs

```
DOMAIN.md        ← Start here. The shared model everything else builds on.
    │
    ├── API.md   ← The canonical HTTP API. Source of truth for all operations.
    │
    ├── CLI.md   ← Human operator interface. Maps CLI commands to API calls.
    │
    ├── MCP.md   ← AI agent interface. Tools that use secrets without exposing them.
    │
    └── SDK.md   ← Programmatic interface. TypeScript client wrapping the API.
```

**DOMAIN.md** defines entities, types, capabilities, and invariants. Every other spec references it — if you need to understand what a `Capability` is or what `zero_knowledge` means, it's in DOMAIN.md.

**API.md** is the authoritative specification for every operation. The CLI, MCP, and SDK are all clients of this API.

**CLI.md**, **MCP.md**, and **SDK.md** define how each surface exposes the domain model. They share the same underlying types and operations, but differ in:
- What operations are available (MCP has no profile/item/agent/permission management)
- What data is returned (MCP never returns secret values)
- How errors are presented (CLI uses stderr, SDK throws, MCP returns error objects)
- Available capabilities (CLI accepts canonical `read`/`use` plus legacy aliases; MCP only consumes secrets via `use_secret`/`mount_secret`)

---

## Design Principles

### 1. Zero-knowledge first

The default storage mode is `zero_knowledge`. The server never sees plaintext for ZK items — all encryption happens client-side (browser or daemon). `server_managed` mode exists as a deliberate opt-in for use cases where remote agents need access.

### 2. Least privilege by default

- Two canonical capabilities only: `read` (read/reveal) and `use` (env/file mount delivery)
- Remote agents: restricted to `read` (reveal) on `server_managed` items only — no ciphertext read, no mounts
- MCP tools: never return raw secrets to the LLM context
- Permissions: per-agent, per-target (item or profile), per-capability — no wildcards

### 3. Explicit over implicit

- No auto-granted permissions in v1
- No inherited access from agent groups
- No wildcard capability grants
- Every access requires an explicit permission record

### 4. Audit everything

Every access attempt is logged — allowed, denied, expired, revoked. The audit log is append-only with no foreign key constraints (survives entity deletion). This is non-negotiable.

### 5. One obvious path per operation

Each operation has one way to do it. There are no alternative endpoints, no shortcut parameters, no implicit behaviors. If the CLI creates a permission, it calls `permissions.create` — the same procedure the dashboard and SDK call.

### 6. Capability-based, not role-based

Access is controlled by specific capabilities on specific targets, not by roles like "admin" or "read-only". This gives fine-grained control: agent A can `use` item X, agent B can `read` item Y. No more, no less.

---

## Surface Comparison

| Operation | API | CLI | MCP | SDK |
|------------|-----|-----|-----|-----|
| Profile bootstrap | yes | (via daemon) | no | yes |
| Profile unlock/lock | no (daemon only) | `profile unlock` / `profile lock` | no | no |
| Item CRUD | yes | yes | list only | yes |
| Agent CRUD | yes | yes | no | yes |
| Permission CRUD | yes | yes | no | yes |
| Access read (ciphertext) | yes | (via daemon) | no | yes |
| Access read (reveal) | yes | no | no | yes |
| Access use (mount) | yes | `run` / `mount` | `use_secret` / `mount_secret` | yes |
| Audit query | yes | yes | yes | yes |

### What each surface does NOT do

- **CLI** does not expose `access.read` (reveal) directly — use `item get` (which decrypts via daemon for ZK) or grant an agent `read`.
- **MCP** does not manage profiles, items, agents, or permissions — it only consumes secrets and reads audit. Management is done through the CLI or dashboard.
- **SDK** does not manage the local daemon — it is a pure HTTP client. Daemon operations are handled by the daemon package.

---

## Architecture Context

```
┌──────────────────────────────────────────────────────────────┐
│                        Control Plane                          │
│                                                              │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌──────────┐ │
│  │ Dashboard  │  │    CLI    │  │    MCP    │  │   SDK    │ │
│  │  (Next.js) │  │  (Bun)   │  │  (stdio)  │  │  (npm)   │ │
│  └─────┬─────┘  └────┬──────┘  └─────┬─────┘  └────┬─────┘ │
│        │              │   ┌───────────┘              │       │
│        │              │   │                          │       │
│        └──────────┬───┘   │   ┌──────────────────────┘       │
│                   │       │   │                              │
│              ┌────▼───────▼───▼────┐                         │
│              │    API (Hono/tRPC)   │                         │
│              │  Cloudflare Workers  │                         │
│              └─────────┬───────────┘                         │
│                        │                                     │
│              ┌─────────▼───────────┐                         │
│              │  Postgres (Drizzle) │                         │
│              └─────────────────────┘                         │
│                                                              │
│  ┌─────────────────────────────────────────┐                 │
│  │            Local Runtime                 │                 │
│  │                                         │                 │
│  │  ┌──────────┐      ┌────────────────┐   │                 │
│  │  │  Daemon   │◄────│  CLI / MCP     │   │                 │
│  │  │(JSON-RPC) │     │  (ZK crypto)   │   │                 │
│  │  └──────────┘      └────────────────┘   │                 │
│  │  Unix socket         Client calls       │                 │
│  └─────────────────────────────────────────┘                 │
└──────────────────────────────────────────────────────────────┘
```

---

## Trust Tiers

| Tier | Component | Trust level | Can see ZK plaintext? |
|------|-----------|-------------|----------------------|
| 1 | Local daemon | Highest | Yes (in memory only) |
| 2 | Browser | High (XSS risk) | Yes (in JS memory) |
| 3 | API server | Medium | No (ZK), Yes (server-managed) |
| 4 | Remote agents | Lowest | No |

---

## Spec Inventory

| File | Purpose | Audience |
|------|---------|----------|
| [DOMAIN.md](./DOMAIN.md) | Shared domain model, types, invariants | All developers |
| [API.md](./API.md) | HTTP API reference (tRPC + REST) | API consumers, backend developers |
| [CLI.md](./CLI.md) | CLI command reference | CLI users, CLI developers |
| [MCP.md](./MCP.md) | MCP tool reference and security model | AI agent integrators |
| [SDK.md](./SDK.md) | TypeScript SDK reference | SDK consumers, integration developers |
| [examples/](../../examples/) | Runnable end-to-end examples for every surface (SDK, CLI, MCP, API) | Anyone integrating abadge |
