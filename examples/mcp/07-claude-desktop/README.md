# MCP: Claude Desktop / Claude Code integration

**What this shows:** wire the abadge MCP server into Claude Desktop (or Claude
Code) so an AI agent can **run commands with secrets** and **mount secret files**
without the secret values ever entering the model's context — the §RED1 boundary.

## Prerequisites

- The `abadge-mcp` binary on your `PATH`
  (`ABADGE_INSTALL_PACKAGE=mcp curl -fsSL https://raw.githubusercontent.com/punitarani/abadge/main/install.sh | bash`),
  plus the `abadge` CLI for the one-time setup.
- A logged-in user (`abadge login`) with an active org and profile.
- Claude Desktop, or a Claude Code install that reads an `mcpServers` config.

## Setup

Run `./setup.sh`. It registers a `local_mcp` agent and prints a ready-to-paste
config block. Mechanically:

1. `abadge agent add --name "claude-desktop" --kind local_mcp --mcp-config`
   generates an Ed25519 keypair, writes the **private key** to
   `~/.abadge/agents/<agent-id>.ed25519.jwk` at mode `0600` (it never leaves
   your machine), registers the **public key** with the API, and prints the
   Claude Desktop server block.
2. Paste the block into your Claude Desktop config
   (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS),
   then restart Claude Desktop. The shape is exactly:

   ```json
   {
     "mcpServers": {
       "abadge": {
         "command": "/Users/you/.abadge/bin/abadge-mcp",
         "env": {
           "ABADGE_API_URL": "https://api.abadge.dev",
           "ABADGE_AGENT_ID": "<agent-id>",
           "ABADGE_PRIVATE_KEY_PATH": "/Users/you/.abadge/agents/<agent-id>.ed25519.jwk"
         }
       }
     }
   }
   ```

   `ABADGE_API_URL`, `ABADGE_AGENT_ID`, and `ABADGE_PRIVATE_KEY_PATH` are the
   three env vars the server reads (it also falls back to `~/.abadge/config.json`,
   and accepts `ABADGE_PRIVATE_KEY` for an inline JWK).

   > **Use an absolute path for `command`.** Claude Desktop is launched by
   > `launchd`/`systemd` with a minimal `$PATH` that does not include
   > `~/.abadge/bin`, so a bare `abadge-mcp` fails with `spawn ENOENT`. The
   > `--mcp-config` flag always emits the absolute path (e.g.
   > `/Users/you/.abadge/bin/abadge-mcp`); the `claude_desktop_config.json` in
   > this folder uses that form. `abadge-mcp` on a bare `$PATH` is fine for
   > terminal-launched clients.
3. Grant the agent a use permission on each item it should consume — without
   an explicit grant, access is **denied** (and audited). Item-target CLI
   grants use the legacy alias `mount_env` (or `mount_file`), which maps to
   canonical `use`:

   ```sh
   abadge permission create --agent-id <agent-id> --item-id <item-id> --capability mount_env
   ```

4. **Zero-knowledge items only:** start the local daemon and unlock the profile
   (`abadge daemon start && abadge profile unlock`) so the MCP server can decrypt
   them locally. Server-managed items need no daemon.

## The five tools

The server registers exactly these. **No tool ever returns a secret value to the
model.**

| Tool | Input | Returns |
|------|-------|---------|
| `list_items` | (none) | item metadata only — `id`, `label`, `kind`, `storageMode`, timestamps. Never values. |
| `use_secret` | `itemId` **or** `profileId` (exactly one), `command`, `args?`, `envVarName?`, `field?`, `purpose?` | `exitCode`, `durationMs`, `outputLineCount.{stdout,stderr}`, `truncated`, `injectedCount?`. **No stdout/stderr text.** |
| `mount_secret` | `itemId`, `field?`, `filename?`, `purpose?` | `{ mountId, permissions: "0600", expiresIn: "5 minutes" }`. The file **path is never returned**; auto-deletes after 5 min. |
| `release_mount` | `mountId` | `{ released: true, mountId }` — deletes the temp file immediately. |
| `get_audit` | `itemId?`, `limit?` (1–100, default 20) | recent audit entries. |

## Keypair-only auth

This MCP server **is an agent**. It authenticates solely with its Ed25519
keypair: at startup it runs a challenge/exchange against the API and gets a
short-lived `abs_` session token (15-min TTL, auto-refreshed at T-2min). It
holds no long-lived bearer.

A personal API key (`abu_`) could **not** drive this server — `abu_` is a
management-only credential and is structurally forbidden from the `access.*`
surface that `use_secret` / `mount_secret` rely on. Reading a secret value
always requires *a keypair agent + an explicit permission*.

## The §RED1 guarantee

`use_secret` injects the secret into the subprocess environment, runs it, and
returns **only** the exit code, duration, per-stream line counts, and a
truncation flag. Subprocess `stdout`/`stderr` text is captured (bounded, 8 KB
per stream) for those counts but is **never** forwarded to the model. That closes
every semantic-leakage channel — base64, hex, nth-character, URL-encoding — that
string-based output redaction cannot catch. The model learns *whether* the
command worked, never *what the secret was*. `mount_secret` is the same idea for
files: the model gets an opaque `mountId`, never the path or the contents.

### Example prompt → tool call → tool result

A user asks Claude in plain language:

> "Use my `STRIPE_API_KEY` secret to run `curl -s https://api.stripe.com/v1/charges`
> and tell me if it succeeded."

Claude resolves the item via `list_items`, then calls `use_secret`:

```json
{
  "itemId": "itm_8f3a...",
  "envVarName": "STRIPE_API_KEY",
  "command": "curl",
  "args": ["-s", "https://api.stripe.com/v1/charges"],
  "purpose": "smoke-test the Stripe charges endpoint"
}
```

The tool injects the secret as `$STRIPE_API_KEY`, runs the command, and returns
**only**:

```json
{
  "exitCode": 0,
  "durationMs": 412,
  "outputLineCount": { "stdout": 1, "stderr": 0 },
  "truncated": false
}
```

Claude can report "it succeeded (exit 0, one line of output)" — but the Stripe
key, and the response body that might echo it, never entered the model's context.
Every one of these calls is recorded in the audit log (`get_audit`), allowed or
denied.
