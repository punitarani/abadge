# CLI conventions

How to drive the CLI binary in a test harness.

## Binary path

The CLI is at `packages/cli/dist/abadge` after `turbo build --filter=@abadge/cli`. The compiled binary is fast to invoke (~150ms cold start), so a harness can call it many times without significant overhead.

If `dist/abadge` doesn't exist, build it:

```bash
turbo build --filter=@abadge/cli
```

## Auth via env vars

```bash
export ABADGE_API_URL=http://localhost:8787
export ABADGE_SESSION_TOKEN="<bearer-from-set-auth-token-header>"
```

That's the supported path for non-interactive testing. The env var only works if the CLI's config file doesn't override it (see next gotcha).

## The config-file priority gotcha

`packages/cli/src/client.ts:requireSessionBaseConfig` reads `~/.abadge/config.json` first and only falls back to `ABADGE_API_URL` if the config file is missing or has no `apiUrl` field:

```ts
const apiUrl = config?.apiUrl ?? process.env.ABADGE_API_URL;
```

If the dev's local config points to production (`https://api.abadge.io`) and you set `ABADGE_API_URL=http://localhost:8787`, the CLI will silently send your **localhost session token** to **production** — and you'll see `Unauthorized` because the token is not valid there. This will burn 20 minutes of debugging the first time you hit it.

**The fix** — move the config aside before the test:

```bash
mv ~/.abadge/config.json ~/.abadge/config.json.bak.pentest 2>/dev/null || true
```

And restore in teardown:

```bash
mv ~/.abadge/config.json.bak.pentest ~/.abadge/config.json 2>/dev/null || true
```

`scripts/teardown.sh` handles this.

## Multi-org gotcha

The CLI uses `cliConfig?.activeOrgId` to set the `X-Abadge-Org-Id` header. With no config file, no header gets set, so a multi-org test user will hit `ORG_HEADER_REQUIRED`.

If your harness creates 2+ orgs (e.g., for cross-org pentests), write a config pointing at the primary test org BEFORE running CLI tests:

```bash
cat > ~/.abadge/config.json <<EOF
{"apiUrl":"$API","activeOrgId":"$ORG_ID"}
EOF
```

Or run CLI tests early in the matrix while the user is still single-org.

## CLI signal: stdout vs stderr

The CLI prints success messages to stdout with a `✓` prefix and errors to stderr with a `✗` prefix. For assertions, prefer matching substrings rather than exact equality (the CLI may add hint lines, color codes, etc.):

```bash
CLI_OUT=$(ABADGE_API_URL=$API ABADGE_SESSION_TOKEN=$SESSION "$CLI" permission create \
  --agent-id "$AGENT_ID" --item-id "$ITEM_ID" \
  --capability mount_env --capability mount_file 2>&1)

[[ "$CLI_OUT" == *"Granted 2 permissions"* ]] && ok "..." || fail "..." "out=$CLI_OUT"
```

Capturing both stdout and stderr with `2>&1` is usually what you want for assertion matching.

## Common smoke tests for any CLI command

Whatever the command, exercise:

1. Happy path — flag combination that should work
2. Missing required flag — should print clean error, exit 1
3. Unknown enum value — should list valid choices
4. Server-side error — should surface the API's `hint` field
5. `--help` text matches the documented surface

For a multi-flag command, also exercise repeated-vs-comma forms (e.g., `--capability X --capability Y` vs `--capability X,Y`).
