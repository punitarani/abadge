---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Stop collapsing every local-daemon failure into a single "start the daemon" message. `abadge run` and the MCP zero-knowledge decrypt path now distinguish a locked vault (→ `abadge profile unlock`), a daemon that isn't running (→ `abadge daemon start`), and other failures, so a user whose daemon is up but locked is no longer told to start it. The MCP messages address the human operator (an agent can't unlock a profile). `abadge profile unlock` now also states the 15-minute auto-lock window.
