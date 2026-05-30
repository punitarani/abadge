---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Observability and UX polish:

- **Permission-denied hints now name the human actor and a copy-pasteable command.** When an agent is denied access (item-target `access.*` and the canonical `read`/`use` pipeline), the `ForbiddenError` hint explains that a person with management access must grant it — via the dashboard Permissions page or `abadge permission create --agent-id <id> --item-id <id> --capability <cap>` — and notes the agent cannot grant its own access. The agent/item/capability are interpolated into the command and attached to `error.meta` for machine consumers. This flows through MCP error responses. Authorization is unchanged (messaging only).
- **`abadge audit` gains filter flags** `--result`, `--agent-id`, `--item-id`, and `--event-type`, passed through to the audit query the server already accepts. `--json` still works.
- **`abadge agent mcp-config <id>` resolves the agent via the API** instead of requiring a match in `~/.abadge/config.json`. An agent registered with `--json` (which never writes the local `mcp` config slot) can now produce a Claude Desktop snippet, as long as its private key exists locally at `~/.abadge/agents/<id>.ed25519.jwk`. A missing key file now produces a clear, distinct error.
