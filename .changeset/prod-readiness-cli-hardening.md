---
"@abadge/cli": patch
---

CLI hardening for production readiness:

- Daemon Ed25519 TOFU handshake now gates sensitive RPCs (`vault.unlock`, `item.encrypt`/`decrypt`, `exec.env`/`mount`, `auth.setSession`/`setOrg`). First run after upgrade triggers a one-time "pinned daemon identity" message and writes the fingerprint to `~/.abadge/config.json`.
- Daemon subprocesses no longer inherit `ABADGE_*` environment variables from the CLI/daemon process (blocks child-process credential exfiltration).
- `vault unlock` now threads the CLI's active organization so multi-org users operate against the correct profile set.
- `--value` is rejected on TTY (shell-history leak prevention; pipe via stdin instead).
- Error rendering uses the server-provided `hint` field from typed `AbadgeApiError` responses.
