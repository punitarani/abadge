# CLI Release

## What ships

`@abadge/cli` ships as one Unix binary named `abadge`.

Current platforms:

* `darwin-x64`
* `darwin-arm64`
* `linux-x64-baseline`
* `linux-arm64-baseline`
* `linux-x64-musl`
* `linux-arm64-musl`

## Identity

CLI release identity is package-scoped:

* tag: `cli-vX.Y.Z`
* release title: `abadge CLI vX.Y.Z`
* archive: `abadge-cli-vX.Y.Z-<target>.tar.gz`
* checksum file: `SHA256SUMS`

## Files that matter

* registry: [`scripts/releases/registry.ts`](../../scripts/releases/registry.ts)
* publish runner: [`scripts/releases/publish.ts`](../../scripts/releases/publish.ts)
* installer: [`install.sh`](../../install.sh)
* workflow: [`.github/workflows/release.yml`](../../.github/workflows/release.yml)

## Normal release path

1. Change CLI release-surface files.
2. Add a changeset.
   While the CLI version is still `0.0.x`, use `patch` so the version train stays on `0.0.2`,
   `0.0.3`, and so on until we intentionally promote it.
3. Merge to `main`.
4. Merge the Changesets version PR.
5. GitHub Actions runs `bun run release:publish`.
6. The publish runner:
   * reads the version from `packages/cli/package.json`
   * builds all CLI targets with Bun `--compile`
   * stages `abadge`
   * creates `.tar.gz` archives
   * writes `SHA256SUMS`
   * creates the `cli-vX.Y.Z` GitHub Release

## Local commands

Dry-run the CLI release:

```bash
bun run release:cli:dry-run
```

Dry-run the generic publisher for the CLI package:

```bash
bun run release:publish -- --dry-run --package cli
```

Write artifacts to a custom directory:

```bash
bun run release:publish -- --dry-run --package cli --outdir /tmp/abadge-cli-release
```

## Installer path

Public install command:

```bash
curl -fsSL https://raw.githubusercontent.com/punitarani/abadge/main/install.sh | bash
```

`install.sh` does this:

1. detect OS, arch, and Linux libc
2. resolve a CLI version
3. map that version to `cli-vX.Y.Z`
4. download the matching archive and `SHA256SUMS`
5. verify SHA-256
6. install `abadge` into `~/.abadge/bin` by default

Installer overrides:

* `ABADGE_VERSION`
* `ABADGE_INSTALL_DIR`
* `ABADGE_INSTALL_BASE_URL`

## Latest resolution

The installer does **not** use GitHub’s repo-wide `releases/latest`.

It fetches the release list and picks the newest stable tag matching `cli-v*`.

That keeps future package releases from breaking CLI installs.
