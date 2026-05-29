# abadge CLI examples

Runnable, heavily-commented `abadge` CLI walkthroughs. The CLI is the
**management** surface (you log in as a user to create items, agents, and
permission grants) plus a thin **access** surface (`abadge run` / `abadge
mount` act as a local agent to actually use a secret). Only an agent holding an
explicit `(agent, item, capability)` permission can ever read or use a secret
value — and every attempt, allowed or denied, is audited.

## The examples

| File | What it shows |
|------|---------------|
| `04-quickstart.sh` | End-to-end loop: login → org/profile → store a secret (piped from stdin) → register a `local_cli` agent → grant `use` → inject the secret into a child process → mount it as a 0600 file → read the audit trail. |
| `05-ci-cd.sh` + `05-github-actions.yml` | Non-interactive CI/CD: the agent's Ed25519 **private key** is the durable CI secret, and `abadge run --all` mints a fresh `abs_` session each run while bulk-injecting every single-field secret in a profile into a deploy command. Includes a ready GitHub Actions job. |
| `06-dotenv-migration.sh` | Migrate a team `.env` into a profile with `abadge import`, run a build with every secret injected via `abadge run --all`, then round-trip with `abadge export`. |

Each example reads IDs and config from the CLI's own state
(`~/.abadge/config.json`) and from environment variables — no real secrets are
hardcoded.

## Prerequisites

- The `abadge` binary on your `PATH`.
  - CLI-only install:
    ```bash
    ABADGE_INSTALL_PACKAGE=cli \
      curl -fsSL https://raw.githubusercontent.com/punitarani/abadge/main/install.sh | bash
    ```
  - Inside this repo for development, run `bun run cli -- <args>` in place of
    `abadge <args>`.
- `jq` — the examples request `--json` from the CLI and parse out IDs.
- A reachable abadge API. Set `ABADGE_API_URL` to override the default, or pass
  `abadge login --api-url <url>`.
- For a **zero_knowledge** profile only: the local daemon
  (`abadge daemon start`) running and the profile unlocked
  (`abadge profile unlock`). The quickstart uses a `server_managed` profile, so
  no daemon or vault password is needed.

## Setup (credentials)

You authenticate as a user with `abadge login` (interactive device-code flow).
This does **not** register an agent — registering the `local_cli` agent is an
explicit step inside the example. The agent's keypair is generated and stored
locally (0600) so `abadge run` / `abadge mount` can act as it.

## Run

```bash
# Full walkthrough (recommended starting point):
bash examples/cli/04-quickstart.sh

# Override the API URL or labels if you like:
ABADGE_API_URL=https://api.abadge.dev ITEM_LABEL=my-key bash examples/cli/04-quickstart.sh
```

Per-file run notes:

- **`04-quickstart.sh`** — Interactive: it will prompt you through `abadge
  login` in the browser. It creates a `quickstart` server_managed profile and a
  `laptop-cli` agent (re-running is safe; the profile-add is tolerant of an
  existing profile). Honors `ABADGE_API_URL`, `ITEM_LABEL`, and `AGENT_NAME`.
  No daemon required.
- **`05-ci-cd.sh`** — Headless CI/CD. `abadge run` acts as an **agent**, so the
  durable CI secret is the agent's Ed25519 private key (`ABADGE_PRIVATE_KEY` +
  `ABADGE_AGENT_ID`), not a session token — `run` performs the challenge/exchange
  itself on every invocation and mints a fresh ~15-min `abs_` session, so there
  is nothing to rotate. It bulk-injects every single-field secret in
  `--profile <id>` into `./deploy.sh` via `abadge run --all`. The optional audit
  summary uses the *management* surface, so it takes a separate `abu_` key
  (`ABADGE_API_KEY`) via `--token-stdin`. `05-github-actions.yml` shows the same
  flow as a GitHub Actions job.
- **`06-dotenv-migration.sh`** — Migrate a team `.env` into the active profile:
  `abadge import .env --dry-run` previews, `abadge import .env` creates
  server_managed items, `abadge run --all -- <build>` runs with everything
  injected, and `abadge export --format env` round-trips. Then delete the
  on-disk `.env`.

## How it works / security notes

- **Two trust tiers.** Your `abadge login` session is management-only: it can
  create items, agents, and grants, but cannot itself reveal a secret value.
  Reading/using a value requires an **agent** (keypair) with an explicit
  permission. That is why the quickstart registers a `local_cli` agent and
  grants it `use` before calling `abadge run`.
- **Secrets never hit your shell history.** `abadge item add --value` is
  rejected on a TTY by design; the examples pipe the secret via stdin
  (`echo -n 'super-secret' | abadge item add ...`).
- **Secrets never hit disk via the CLI's normal path.** `abadge run` injects
  the value directly into the child process's environment. `abadge mount`
  writes a 0600 temp file that auto-cleans and only ever hands you the *path*.
- **Capabilities are explicit and minimal.** Canonical capabilities are `read`
  (reveal/ciphertext) and `use` (env/file mount). Grant only what the agent
  needs; repeat `--capability` to grant more than one.
- **Everything is audited.** `abadge audit` shows the immutable record of every
  allowed and denied access — the accountability half of the firewall.
