---
name: pr-ready
description: Use when getting an abadge PR merge-ready, checking whether a branch is mergeable, resolving conflicts against main, recovering after a rebase, verifying CI is green, or shepherding a PR through checks and review comments. Triggers on "is this merge-ready", "get this PR green", "rebase onto main", "did I lose commits", "force push", "address the review comments".
---

# PR Ready

Read the `## Git & PR workflow` section in `AGENTS.md` if PR or CI behavior changed.

## Trust These Facts

* Required PR checks live in `.github/workflows/ci-cd.yml`.
* Merge-gating jobs: `changeset-check`, `lint`, `audit`, `typecheck`, `test-unit`, `test-integration`, `test-web`, `e2e`, `build-api`, `build-cli`, `build-web`, `db-validate`.
* Local equivalents: `bun run lint`, `bun run typecheck`, `bun run test:cov:unit`, `bun run test:cov:integration`, `bun run --cwd apps/web test`, `bun run test:e2e`.
* Release-surface paths live in `scripts/releases/registry.ts` (packages `cli`, `mcp`). Touching them requires a changeset in `.changeset/`, or `changeset-check` blocks the PR.
* Base branch is `main`. Rebase onto `origin/main`. The repo merges with **merge commits**, not squash.
* "Merge-ready" means CI is green via `gh pr checks`, not that the diff looks right.

## Use This Workflow

1. **Snapshot before touching history.** Record the tip so a bad rebase is recoverable: `git rev-parse HEAD` (and `git reflog` is always available). Never start a rebase blind.
2. **Sync and rebase.** `git fetch origin && git rebase origin/main`. Resolve conflicts against `origin/main`. Rebase in small increments, not one long chain.
3. **Verify nothing was stripped.** Compare commit count/subjects against the snapshot. If commits vanished, recover with `git reflog` + `git cherry-pick` — do not redo the work from memory.
4. **Run the local gate.** `bun run lint && bun run typecheck`, then the relevant test buckets. Fix failures (including SSR/build breaks — see the SSR-safe-state rule in `AGENTS.md` Web rules) before pushing.
5. **Changesets.** If the diff touches a release surface, add a changeset (`bun run changeset`) describing the bump.
6. **Push.** `git push --force-with-lease` (never bare `--force`).
7. **Confirm CI.** `gh pr checks <pr>` — wait for every gating job to pass.
8. **Address review.** Resolve Greptile/reviewer comments; keep replies concise; re-run the gate after changes.

## Only Report Merge-Ready When

* `gh pr checks <pr>` shows all gating jobs green (not pending, not skipped-by-error).
* No commits were lost in rebase (verified against the step-1 snapshot).
* Changeset present if a release surface changed.

Until all three hold, report status honestly ("CI still running", "2 checks red") — never "merge-ready".
