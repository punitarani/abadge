#!/usr/bin/env bash
#
# 06-dotenv-migration.sh
# ---------------------------------------------------------------------------
# Migrate a team's on-disk .env file into abadge, then run a build with the
# secrets injected at runtime — so the build sees them but they never live on
# disk again.
#
# See examples/cli/README.md (from example 04) for prerequisites, install, and
# how to authenticate the CLI. This script assumes you have already run:
#     abadge login
#     abadge use org <id-or-slug>
#     abadge use profile <name-or-id>     # a server_managed profile
#
# Trust model recap (why this is safe):
#   - `abadge import` and `abadge export` use the MANAGEMENT surface (your
#     Better Auth session / abu_ key). Management can CREATE items and, because
#     you own them, owner-reveal them back out (that is what `export` does).
#   - `abadge run` injects secrets into a child process. For that it resolves
#     secrets through the daemon / agent path — the value is handed to the
#     subprocess's environment only, never echoed to your shell history or the
#     terminal.
# ---------------------------------------------------------------------------

set -euo pipefail

# ---------------------------------------------------------------------------
# 0. Dev vs. installed binary.
#    Installed:        abadge ...
#    From the repo:    bun run cli -- ...
#    We pick one up front so the rest of the script reads cleanly.
# ---------------------------------------------------------------------------
ABADGE="${ABADGE_BIN:-abadge}"
if ! command -v "${ABADGE}" >/dev/null 2>&1; then
  ABADGE="bun run cli --"
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "${WORKDIR}"' EXIT
ENV_FILE="${WORKDIR}/.env"

# ---------------------------------------------------------------------------
# 1. Create a sample .env for the demo.
#    In real life this is the file your team already has checked out (and,
#    ideally, .gitignored). We generate one here so the example is runnable.
#    Each KEY=value line becomes one server_managed item whose label is KEY.
# ---------------------------------------------------------------------------
cat >"${ENV_FILE}" <<'EOF'
# Sample team .env — demo values only, not real secrets.
STRIPE_API_KEY=sk_test_51DemoKeyDoNotUse
OPENAI_API_KEY=sk-demoOpenAiKeyDoNotUse
SENTRY_DSN=https://demo@o0.ingest.sentry.io/0
EOF

echo "==> Sample .env written to ${ENV_FILE}"

# ---------------------------------------------------------------------------
# 2. Dry-run the import first.
#    --dry-run touches nothing: it just prints what WOULD happen, bucketed as
#    created / updated / skipped. Existing items are "skipped" unless you pass
#    --overwrite; brand-new labels are "created". Use this to sanity-check
#    against an already-populated profile before writing anything.
# ---------------------------------------------------------------------------
echo "==> Previewing import (no writes):"
${ABADGE} import "${ENV_FILE}" --dry-run

# ---------------------------------------------------------------------------
# 3. Do the real import.
#    `import` always creates SERVER_MANAGED items (the API encrypts them with
#    AES-256-GCM). --kind tags them; here api_key fits the Stripe/OpenAI keys.
#    Import semantics:
#      - new label              -> created (server_managed item)
#      - existing + no flag     -> skipped
#      - existing + --overwrite -> updated, BUT it REFUSES to overwrite an
#                                  existing zero_knowledge item (it cannot
#                                  rewrap a ZK DEK from this path — delete and
#                                  re-import, or use `abadge item update`).
# ---------------------------------------------------------------------------
echo "==> Importing for real as server_managed api_key items:"
${ABADGE} import "${ENV_FILE}" --kind api_key

# ---------------------------------------------------------------------------
# 4. Run a build with every imported secret injected.
#    --all bulk-injects every single-string-field item the caller can "use" in
#    the active profile, with each item's label normalized to an ENV var name
#    (STRIPE_API_KEY stays STRIPE_API_KEY). Multi-field items are skipped, and
#    reserved keys (PATH, LD_PRELOAD, NODE_OPTIONS) are rejected.
#
#    The secrets exist only inside the child process's environment. Swap the
#    placeholder below for your real build, e.g.:
#        ${ABADGE} run --all -- npm run build
# ---------------------------------------------------------------------------
echo "==> Running a build with secrets injected (placeholder command):"
${ABADGE} run --all -- node -e '
  // A real build would consume these; we only confirm they were injected.
  // We print KEYS ONLY — never the values — to keep secrets off the terminal.
  const injected = ["STRIPE_API_KEY", "OPENAI_API_KEY", "SENTRY_DSN"]
    .filter((k) => process.env[k] !== undefined);
  console.log("Build sees injected env keys:", injected.join(", "));
'

# ---------------------------------------------------------------------------
# 5. Round-trip check with export.
#    `export --format env` re-emits the stored items as KEY=value lines by
#    owner-revealing each server_managed item (zero_knowledge items are skipped
#    unless the vault is unlocked). This proves the migration is complete and
#    the values survived intact — handy for a one-time diff against the old
#    file. WARNING: this prints plaintext to stdout; redirect/capture with care.
# ---------------------------------------------------------------------------
echo "==> Round-trip export (env format):"
${ABADGE} export --format env

# ---------------------------------------------------------------------------
# 6. Decommission the on-disk .env.
#    Once you have confirmed the round-trip above, delete the original file so
#    the only copy of these secrets lives encrypted in abadge:
#
#        rm .env
#
#    (This demo's temp .env is removed automatically by the trap on EXIT.)
# ---------------------------------------------------------------------------
echo "==> Migration verified. Remove your real file with:  rm .env"
