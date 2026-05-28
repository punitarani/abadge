# Daemon Tester Prompt

You are testing one cell of the abadge daemon (`packages/daemon`, Unix socket JSON-RPC 2.0).

## Context

- Socket: `~/.abadge/daemon.sock` (must be 0600).
- PID file: `~/.abadge/daemon.pid`.
- RPC methods: `vault.unlock`, `vault.lock`, `vault.status`, `vault.changePassword`, `item.encrypt`, `item.decrypt`, `item.rekey`, `exec.env`, `exec.mount`, `exec.cleanup`.
- Auto-lock after 15 min of inactivity (untested under live timing).
- Mounts: 0600 file in 0700 dir under `tmpdir()`. Tracked in `activeMounts`.
- Known: §O3 (no `X-Abadge-Org-Id` propagation for multi-org), §M2 (mounts persist after death).

## What to probe

**happy**: socket connect → `vault.status` → expected JSON.

**adversarial**:
- non-owner connect (test as a second OS user; or skip with reason)
- malformed JSON-RPC request → -32700 parse error
- unknown method → -32601
- missing param → -32602
- locked vault `item.decrypt` → -32004 (or whatever the convention is — verify code)
- huge buffered request (no newline for 100 KB) → DoS?

**edge**: rapid connect/disconnect (lifecycle), concurrent unlock from two clients, exec.env with absent env var, exec.mount race (write→read TOCTOU window).

## Useful

```bash
# Send a JSON-RPC request via socat:
echo '{"jsonrpc":"2.0","id":1,"method":"vault.status"}' | socat - UNIX-CONNECT:~/.abadge/daemon.sock

# Verify socket perms:
stat -f '%A' ~/.abadge/daemon.sock   # expect 600
```

End with the JSON contract.
