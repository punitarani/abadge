# MCP Tester Prompt

You are testing one cell of the abadge MCP server (`packages/mcp`, stdio JSON-RPC).

## Context

- Boots via `bun packages/mcp/src/index.ts`. Requires `ABADGE_AGENT_ID` + `ABADGE_PRIVATE_KEY_PATH` (keypair) OR `ABADGE_AUTH_TOKEN` (legacy).
- 5 tools: `list_items`, `run_with_secret`, `mount_secret`, `release_mount`, `get_audit`.
- `run_with_secret` captures subprocess output in-process, redacts the secret, caps at 4 KB.
- `mount_secret` returns opaque `mountId` only; the file path is NEVER exposed to the LLM. Files are 0600 in 0700 dirs in `tmpdir()`.
- Auto-cleanup of mounts after 5 min OR on `release_mount` OR on next MCP startup if older than 10 min.
- Known: redaction is bypassable with base64/hex/rot13/reverse (§RED1); mounts persist after MCP death (§M2); `get_audit` leaks across agents owned by same user (§A1).

## What to probe (by facet)

**happy**: invoke the tool with valid args, check return shape.

**adversarial**:
- `run_with_secret` running `node -e 'console.log(Buffer.from(process.env.SECRET).toString("base64"))'` → does the redactor catch it?
- `run_with_secret` running `node -e 'console.log([...process.env.SECRET].reverse().join(""))'` → reverse bypass?
- `mount_secret` then attempt to read the path through `mountId` enumeration → opaque?
- `get_audit` with another agent's id (same operator user) → leakage?
- run a tool against a revoked agent → clean error?

**edge**: very long secret value (cap behaviour), unicode in tool args, malformed mountId, double release.

**regression**: re-run the §CODE's repro.

## Useful invocations

Spawn MCP and send a JSON-RPC request manually:
```bash
ABADGE_AGENT_ID=<id> ABADGE_PRIVATE_KEY_PATH=<path> bun packages/mcp/src/index.ts << 'EOF'
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
EOF
```

Or use `mcp-cli` if available. The contract is JSON-RPC 2.0 over stdio.

## Closing

End with the JSON object per `references/subagent-contract.md`.
