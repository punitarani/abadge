# MCP Release

## What ships

`@abadge/mcp` ships as one Unix binary named `abadge-mcp`.

Current platforms:

* `darwin-x64`
* `darwin-arm64`
* `linux-x64-baseline`
* `linux-arm64-baseline`
* `linux-x64-musl`
* `linux-arm64-musl`

## Identity

MCP release identity is package-scoped:

* tag: `mcp-vX.Y.Z`
* release title: `abadge MCP server vX.Y.Z`
* archive: `abadge-mcp-vX.Y.Z-<target>.tar.gz`
* checksum file: `SHA256SUMS`

## Files that matter

* registry: [`scripts/releases/registry.ts`](../../scripts/releases/registry.ts)
* publish runner: [`scripts/releases/publish.ts`](../../scripts/releases/publish.ts)
* installer: [`install.sh`](../../install.sh)
* workflow: [`.github/workflows/release.yml`](../../.github/workflows/release.yml)

## Normal release path

1. Change MCP release-surface files.
2. Add a changeset.
3. Merge to `main`.
4. Merge the Changesets version PR.
5. GitHub Actions runs `bun run release:publish`.
6. The publish runner:
   * reads the version from `packages/mcp/package.json`
   * builds all MCP targets with Bun `--compile`
   * stages `abadge-mcp`
   * creates `.tar.gz` archives
   * writes `SHA256SUMS`
   * creates the `mcp-vX.Y.Z` GitHub Release

## Local commands

Dry-run the MCP release:

```bash
bun run release:mcp:dry-run
```

Dry-run the generic publisher for the MCP package:

```bash
bun run release:publish -- --dry-run --package mcp
```

Write artifacts to a custom directory:

```bash
bun run release:publish -- --dry-run --package mcp --outdir /tmp/abadge-mcp-release
```

## Installer path

Public install command (installs both CLI and MCP by default):

```bash
curl -fsSL https://raw.githubusercontent.com/punitarani/abadge/main/install.sh | bash
```

Install only the MCP binary:

```bash
ABADGE_INSTALL_PACKAGE=mcp \
  curl -fsSL https://raw.githubusercontent.com/punitarani/abadge/main/install.sh | bash
```

`install.sh` does this for each selected package:

1. detect OS, arch, and Linux libc
2. resolve the package's version (scoped env > unscoped fallback for single-package > GitHub releases)
3. map that version to `<package>-vX.Y.Z`
4. download the matching archive and `SHA256SUMS`
5. verify SHA-256
6. install the binary into `~/.abadge/bin` by default

Installer overrides:

* `ABADGE_INSTALL_PACKAGE` — `cli`, `mcp`, or `all` (default `all`)
* `ABADGE_MCP_VERSION` — pin the MCP release
* `ABADGE_CLI_VERSION` — pin the CLI release
* `ABADGE_VERSION` — fallback for single-package installs only; rejected when installing multiple packages
* `ABADGE_INSTALL_DIR`
* `ABADGE_INSTALL_BASE_URL`

## Latest resolution

The installer does **not** use GitHub's repo-wide `releases/latest`.

It fetches the release list and picks the newest stable tag matching `mcp-v*` (separately from `cli-v*`).

Each package's release cadence is independent.
