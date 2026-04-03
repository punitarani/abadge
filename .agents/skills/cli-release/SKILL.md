---
name: cli-release
description: Prepare, validate, and publish abadge CLI releases and the PRs that carry them. Use when updating the CLI release pipeline, checking changesets or versioning, dry-running release artifacts or the installer, or committing, pushing, reviewing, and merge-prepping the CLI release PR.
---

# CLI Release

Read [overview](../../../docs/release/overview.md) and [CLI release](../../../docs/release/cli.md) if release behavior changed.

## Trust These Facts

* CLI release package id is `cli`.
* Release packages and release-surface paths live in `scripts/releases/registry.ts`.
* CLI tags are `cli-vX.Y.Z`.
* CLI archives are `abadge-cli-vX.Y.Z-<target>.tar.gz`.
* The installer resolves `cli-v*` from the release list, not `releases/latest`.
* Ship Unix targets only.

## Use This Workflow

1. Inspect the branch.
   * `git status --short`
   * `git rev-list --left-right --count HEAD...origin/main`
2. Verify versioning inputs.
   * read `packages/cli/package.json`
   * inspect `/.changeset/*.md`
   * run `bun scripts/releases/check-changeset.ts --base-ref main`
   * if release-surface files changed, require a root changeset
3. Validate the repo.
   * `bun run format`
   * `bun run lint`
   * `rm -rf apps/web/.next && bun run typecheck`
   * `bun test`
4. Dry-run the release.
   * `bun run release:cli:dry-run -- --outdir /tmp/abadge-cli-release`
   * `bun run release:publish -- --dry-run --package cli --outdir /tmp/abadge-cli-release-publish`
5. Smoke-test the installer.
   * `ABADGE_VERSION=$(jq -r .version packages/cli/package.json)`
   * `ABADGE_INSTALL_BASE_URL=file:///tmp/abadge-cli-release ABADGE_INSTALL_DIR=/tmp/abadge-cli-install ./install.sh`
   * verify the installed `abadge --version`
   * if `/tmp` is `noexec`, copy the binary into the workspace before running it
6. Commit and push only if requested or necessary.
7. Inspect or update the PR.
   * `gh pr view`
   * `gh pr checks --watch`

## Merge Main Into The PR

1. `git fetch origin`
2. Merge `origin/main` unless the user explicitly asked for a rebase.
3. Resolve conflicts without dropping:
   * package-scoped tags and assets
   * installer `cli-v*` resolution
   * session-cookie CLI auth
   * local CLI agent bootstrap and rotation logic
   * daemon readiness and pid-file safety fixes
4. Rerun the full validation stack.
5. Push the merge commit.
6. Confirm `gh pr view --json mergeable,mergeStateStatus,isDraft` and required checks.

## Review Before Calling Ready

* `registry.ts` still uses the correct CLI tag prefix, asset prefix, target ids, and `changePaths`
* the installer asset ids match the registry target ids
* the latest lookup filters stable `cli-v*` tags
* the dry-run emits all six Unix archives and `SHA256SUMS`
* the docs still match the current release path

## Report Only

* whether a changeset is present when needed
* validation commands run and their result
* dry-run result
* installer smoke result
* commit id and branch if you pushed
* PR mergeability and remaining checks
