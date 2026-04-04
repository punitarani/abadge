# Architecture

## Overview

abadge is a synchronous credential control plane for agent access.

Users:

* own vaults and items
* authenticate as human operators through Better Auth
* register agents
* grant per-item permissions
* inspect every access attempt through an append-only audit log

The system keeps one synchronous control plane:

* Postgres is the single source of truth
* Hono runs as the outer Cloudflare Worker shell
* tRPC is the canonical application transport
* local daemon and broker IPC stay on JSON-RPC over a Unix socket

## System parts

* **API worker**: Hono middleware for headers, CORS, rate limiting, Better Auth, `/health`, and the mounted tRPC fetch adapter at `/trpc`
* **Web**: Next.js App Router dashboard plus Better Auth device-approval pages
* **CLI**: local operator tool; management commands use daemon-held operator auth, runtime commands use local agent sessions
* **SDK**: `AbadgeClient`, implemented on top of the shared tRPC client
* **MCP**: local Model Context Protocol server that authenticates as a local runtime agent
* **Daemon**: local vault runtime that unlocks, encrypts, decrypts, mounts files, spawns subprocesses, and stores the operator session in memory
* **Database**: single Postgres instance accessed through Drizzle

## Router layout

`packages/trpc` owns:

* `publicProcedure`
* `sessionProcedure`
* `agentProcedure`
* request-context creation
* browser and node clients
* error normalization

The router is split into:

* `auth`
* `vault`
* `items`
* `agents`
* `permissions`
* `access`
* `audit`

## Identity model

There are three effective auth personas:

* **human operator session**: Better Auth cookie or bearer access token
* **local runtime agent**: keypair-backed local agent using short-lived `abs_...` sessions
* **remote runtime agent**: keypair-backed remote agent using bootstrap enrollment and short-lived `abs_...` sessions

Legacy `abl_...` and `abg_...` API keys remain as a migration path only.

## Request context

Each tRPC request constructs context once:

* Worker env
* validated worker env
* per-request DB handle
* Better Auth instance
* request headers
* response headers
* derived IP address

Procedure middleware then adds identity:

* `sessionProcedure` resolves a Better Auth session or bearer session token
* `agentProcedure` resolves an `abs_...` session token first, then legacy API keys

## Local flow

### CLI management flow

1. `abadge login` starts device authorization
2. browser approval happens on the web app
3. CLI stores the operator access token in daemon memory only
4. management commands read that token from the daemon and call session procedures

### Local runtime flow

1. local CLI or MCP loads a stored local agent reference from `~/.abadge/config.json`
2. it signs a challenge with the local private key
3. the API issues a short-lived `abs_...` agent session
4. the runtime calls `access.*`
5. zero-knowledge decrypt stays in the daemon

## Persistence model

Core persisted entities:

* `vaults`
* `items`
* `principals`
* `grants`
* `audit_log`
* `agent_enrollment_tokens`
* `agent_session_challenges`
* `agent_sessions`
* Better Auth tables, including `deviceCode`

There is no background job system.
