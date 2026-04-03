# Release Overview

## Model

Releases are package-scoped, not repo-scoped.

Key terms:

* **Changeset**: version bump input in `/.changeset/*.md`
* **Release package**: an explicit entry in [`scripts/releases/registry.ts`](../../scripts/releases/registry.ts)
* **Target**: one publish output for a release package
* **Tag prefix**: GitHub release namespace for a target, for example `cli-v`

## Source of truth

Release automation only sees packages listed in [`scripts/releases/registry.ts`](../../scripts/releases/registry.ts).

That file defines:

* package id
* workspace dir
* version source
* release-surface paths
* publish targets

`private: false` does not make a package releasable by itself.

## Current state

Today only one package is registered:

* `cli` -> `@abadge/cli`

Its target is:

* `github-binary`

## Flow

1. Change release-surface files.
2. Add a changeset in `/.changeset/`.
3. Merge to `main`.
4. [`.github/workflows/release.yml`](../../.github/workflows/release.yml) runs Changesets.
5. Changesets opens or updates the version PR.
6. Merge the version PR.
7. The same workflow runs `bun run release:publish`.
8. [`scripts/releases/publish.ts`](../../scripts/releases/publish.ts) publishes every registered package target.

## Safety checks

Before merge:

* [`scripts/releases/check-changeset.ts`](../../scripts/releases/check-changeset.ts) blocks release-surface changes without a changeset

Before publish:

* `release:publish` skips if unreleased changesets still exist
* existing GitHub tags are not republished

## How to add another releasable package

1. Add the package to [`scripts/releases/registry.ts`](../../scripts/releases/registry.ts).
2. Give it its own tag prefix and asset naming.
3. Add its release-surface paths.
4. Add or extend publish logic if it needs a new target kind.
5. Add tests in [`scripts/releases.test.ts`](../../scripts/releases.test.ts).

Do not reuse repo-global tags like `v1.2.3`.
