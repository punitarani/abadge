#!/usr/bin/env bash
#
# Cloud-only SessionStart hook: hydrate a Claude Code cloud session with abadge's Doppler
# secrets, then start the local Postgres that DATABASE_URL points at.
#
# Why a committed SessionStart hook (and not the cloud "Setup script")?
#   $CLAUDE_ENV_FILE -- the only mechanism that makes env vars ambient for every Bash
#   command Claude runs -- is available ONLY inside hooks (SessionStart/Setup/...), never
#   in the cloud Setup script (which runs pre-launch in a throwaway shell whose exports
#   don't persist). And in Claude Code on the web, only hooks committed to the repo run.
#     - https://code.claude.com/docs/en/hooks#sessionstart
#     - https://code.claude.com/docs/en/claude-code-on-the-web  (Setup scripts vs SessionStart hooks)
#
# Safe to commit / safe locally: this is a no-op unless it's a Claude Code cloud session
# that has the Doppler CLI and a scoped DOPPLER_TOKEN, so local developer sessions are
# untouched.

set -u

# 1) Only act inside a Claude Code cloud session.
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

# 2) Require the Doppler CLI (installed by the cloud Setup script) and a scoped token
#    (provided via the cloud environment's "Environment variables" field).
command -v doppler >/dev/null 2>&1 || { echo "[abadge] doppler CLI not found -- skipping secret hydration." >&2; exit 0; }
[ -n "${DOPPLER_TOKEN:-}" ]        || { echo "[abadge] DOPPLER_TOKEN not set -- skipping secret hydration." >&2; exit 0; }
[ -n "${CLAUDE_ENV_FILE:-}" ]      || { echo "[abadge] CLAUDE_ENV_FILE unset -- cannot persist env this session." >&2; exit 0; }

# 3) Pull every secret from the dev_agents config and append sourceable `export KEY="value"`
#    lines. Claude Code sources $CLAUDE_ENV_FILE as shell, so values need `export` + quotes.
#      --format env       : KEY="value" (quoted; survives base64 +/=, URLs, etc. -- verified)
#      --no-check-version : the CLI update notice would otherwise corrupt the file
#      --project/--config : pin scope explicitly. The repo's committed doppler.yaml pins
#                           config `dev`, which this dev_agents-scoped token is refused;
#                           passing the flags overrides it and keeps the field to just the token.
if secrets="$(doppler secrets download --no-file --format env --no-check-version --project abadge --config dev_agents 2>/dev/null)"; then
  printf '%s\n' "$secrets" | sed 's/^/export /' >>"$CLAUDE_ENV_FILE"
  echo "[abadge] Loaded $(printf '%s\n' "$secrets" | grep -c '=') secrets from Doppler (dev_agents) into the session."
else
  echo "[abadge] Failed to download Doppler secrets -- check DOPPLER_TOKEN and network access." >&2
fi

# 4) Start the local Postgres that DATABASE_URL targets. The role/db are created once by the
#    cached Setup script; the server process must be (re)started each session.
service postgresql start >/dev/null 2>&1 || true

exit 0
