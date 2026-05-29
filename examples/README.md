# abadge examples

Runnable, end-to-end examples for every abadge surface — the **SDK**, **CLI**, **MCP server**, and the raw **HTTP API** — in TypeScript, bash, Python, and JSON.

Each example is self-contained with its own README covering prerequisites, setup, and how to run it. They are written to be *correct against the current code*, not just illustrative.

## The one idea every example reinforces

abadge has two trust tiers, and the examples are organized around the boundary between them:

| Tier | Identity | Can it read a secret **value**? |
|------|----------|--------------------------------|
| **Management** | Better Auth session, or an `abu_` personal API key (`AbadgeUserClient`) | **No.** Creates items/agents/permissions and reads audit only. |
| **Access** | An Ed25519 **keypair agent** that exchanges a signed challenge for a short-lived `abs_` session (`AbadgeAgentClient`) | **Yes** — but only for an item it holds an explicit `(agent, item, capability)` permission on. |

The credential that *manages* the vault is never the credential that can *read secrets out of it*. Watch for this split in every example.

## Index

### SDK — `@abadge/sdk` (TypeScript)

| Example | What it shows |
|---------|---------------|
| [`sdk/01-store-and-grant`](./sdk/01-store-and-grant) | Operator side: store a `server_managed` secret, register a remote agent (bootstrap token), grant `read`, read the audit trail. Never reads the value. |
| [`sdk/02-agent-read-secret`](./sdk/02-agent-read-secret) | Agent side: connect with an Ed25519 keypair, `access.read` a granted secret (both storage modes), use it on an outbound call, `disconnect`. |
| [`sdk/03-agent-enroll`](./sdk/03-agent-enroll) | Zero-pre-shared-secret onboarding: generate a keypair locally, `enroll` with a one-time bootstrap token, then connect and read. The private key never leaves the agent. |

### CLI — `abadge`

| Example | What it shows |
|---------|---------------|
| [`cli/04-quickstart.sh`](./cli/04-quickstart.sh) | Full developer walkthrough: login → profile → store a secret via stdin → register a local agent → grant → `abadge run`/`mount` → audit. |
| [`cli/05-ci-cd.sh`](./cli/05-ci-cd.sh) + [`05-github-actions.yml`](./cli/05-github-actions.yml) | Non-interactive CI: `--token-stdin` auth and bulk secret injection with `abadge run --all`, plus a ready GitHub Actions job. |
| [`cli/06-dotenv-migration.sh`](./cli/06-dotenv-migration.sh) | Migrate a team `.env` into a profile with `abadge import`, run a build with everything injected, then delete the on-disk file. |

See [`cli/README.md`](./cli/README.md) for the shared CLI prerequisites.

### MCP server — `abadge-mcp` (for AI agents)

| Example | What it shows |
|---------|---------------|
| [`mcp/07-claude-desktop`](./mcp/07-claude-desktop) | Wire the MCP server into Claude Desktop / Claude Code so an agent can `use_secret` and `mount_secret` **without the secret value ever entering the model's context** (the §RED1 boundary). |

### HTTP API — REST `/v1` and the agentic-registration flow

| Example | Language | What it shows |
|---------|----------|---------------|
| [`api/08-rest-curl`](./api/08-rest-curl) | bash + curl | Management from any runtime with an `abu_` key: create item, register agent, grant, read audit. |
| [`api/09-agent-python`](./api/09-agent-python) | Python | Agent access from Python: request a challenge, sign it with Ed25519, exchange for an `abs_` token, `read` a secret. |
| [`api/10-agentic-registration-python`](./api/10-agentic-registration-python) | Python | The auth.md "anonymous" flow: an agent self-registers a personal account a human later claims by email + OTP. |

## Prerequisites at a glance

- **A running abadge API.** Point examples at it via `ABADGE_API_URL` (hosted: `https://api.abadge.dev`; local dev: `http://localhost:8787`).
- **SDK examples:** `bun add @abadge/sdk` (or `npm i @abadge/sdk`). Run with `bun run <file>.ts` or `npx tsx <file>.ts`.
- **CLI examples:** install the CLI — `curl -fsSL https://raw.githubusercontent.com/punitarani/abadge/main/install.sh | bash`.
- **MCP example:** install the MCP server — `ABADGE_INSTALL_PACKAGE=mcp curl -fsSL https://raw.githubusercontent.com/punitarani/abadge/main/install.sh | bash`.
- **Python examples:** `pip install -r requirements.txt` inside the example directory (Python 3.10+).

No example hardcodes a real secret; all credentials and IDs come from environment variables.

## See also

- [Quickstart](../apps/docs/quickstart.mdx) · [SDK reference](../apps/docs/api/sdk) · [CLI reference](../apps/docs/cli) · [MCP reference](../apps/docs/mcp) · [API reference](../docs/specs/API.md)
- [Security model](../docs/SECURITY.md) · [Capabilities](../docs/CAPABILITIES.md) · [Fields](../docs/FIELDS.md)
