---
"@abadge/cli": patch
"@abadge/mcp": patch
---

CI hygiene: the release workflow (`release.yml`) now uses a shared `.github/actions/setup` composite action that pins Bun, restores the Bun install cache (keyed on `bun.lock`), and installs with a frozen lockfile, instead of an inline toolchain + cold install. No change to the released CLI/MCP binaries or their build commands; this only affects how the release pipeline provisions its toolchain.
