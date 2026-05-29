---

---

Add a Doppler-backed SessionStart hook (`scripts/cloud/load-doppler-env.sh`) plus `.claude/settings.json` so Claude Code cloud (web) sessions load `dev_agents` secrets dynamically, and document the setup in `docs/DEVELOPMENT.md`. Infrastructure/docs only -- no release-managed package (`@abadge/cli`, `@abadge/mcp`) behavior changes, so no version bump.
