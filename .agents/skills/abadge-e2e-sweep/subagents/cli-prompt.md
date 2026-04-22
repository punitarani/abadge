# CLI Tester Prompt

You are testing one cell of the abadge CLI surface (`packages/cli`, the compiled bun binary).

## Context

- Binary path during dev: `bun run cli -- <args>` from repo root, OR `packages/cli/bin/abadge` after `bun run build`.
- Config: `~/.abadge/config.json` (`apiUrl`, `activeOrgId`, `activeProfileId`).
- Daemon: starts via `abadge daemon start`; Unix socket at `~/.abadge/daemon.sock` (0600); PID file at `~/.abadge/daemon.pid`.
- TTY value-flag guard: `abadge run --value` is rejected on TTY (history leak). `abadge item create --value` is NOT (§CLI6 — verify still open or fixed).
- Multi-org users hit the §O3 daemon header bug: `abadge profile unlock` fails with `X-Abadge-Org-Id header required for multi-org users`.

## What to probe (by facet)

**happy**: run the command with sensible defaults; assert exit 0 + expected stdout shape.

**adversarial**:
- `abadge item create --value "secret"` on TTY → leaks to shell history? (§CLI6)
- `abadge run --value "secret"` on TTY → properly rejected with hint?
- `abadge daemon start` twice in a row → second invocation fails cleanly?
- Bad token in config → useful error (with `hint`)?

**edge**:
- empty arg, missing required arg, unknown flag → exit nonzero with usage hint
- pipe vs TTY (`echo secret | abadge item create --value -`) — should accept
- daemon lock file stale → recovery behaviour
- multi-org user with no `activeOrgId` → graceful "run org use first"

**regression**: re-verify the cell's `refers_to` §CODE.

## Useful invocations

```bash
# Run with explicit config dir (avoids polluting real ~/.abadge):
ABADGE_CONFIG_DIR=$(mktemp -d) bun run cli -- --version

# Force TTY for a test:
script -q /dev/null bun run cli -- item create --name foo --value secret

# Force pipe (no TTY):
echo secret | bun run cli -- item create --name foo --value -

# Inspect daemon socket perms:
stat -f '%A' ~/.abadge/daemon.sock
```

## Specific landmines

- `--value` on TTY for `item create` (§CLI6) — controller wants this as a regression test.
- `org use <name>` before `org list` works for multi-org user (§O2 catch-22).
- Daemon doesn't propagate `X-Abadge-Org-Id` (§O3) — `vault unlock` fails for multi-org user.
- `import`/`export` round-trip fidelity (§IMP1, §EXP1, §EXP2).

## Closing

End with the JSON object per `references/subagent-contract.md`.
