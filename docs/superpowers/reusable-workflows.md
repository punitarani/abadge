# Reusable Claude Code workflows

Copyable prompts distilled from the 2026-05-29 `/insights` report, adapted to abadge's
stack (Bun, Turborepo, Doppler) and existing skills (`pr-ready`, `abadge-e2e-sweep`,
`abadge-security-audit`, `live-test-matrix`, `cli-release`). Paste a block to kick off
the workflow; tune the specifics per task.

## Session hygiene

Habits that keep long autonomous runs from stalling or drifting.

**Keep responses terse, write detail to files.** Avoids output-cap stalls on long runs.
> Keep chat responses short. Write any long report, plan, or analysis to a markdown file under `docs/superpowers/` and just tell me the path.

**Prefer DOM tools over screenshots in the browser.** CDP screenshots stall; `read_page`/
`evaluate_script`/`snapshot` are reliable.
> For browser tasks use the snapshot / read_page / evaluate tools over screenshots, which stall frequently. Screenshot only when a visual is explicitly needed.

**Verify correctness + cost on any infra migration before merging.**
> For this infra change, verify numerical correctness against the baseline (report the correlation) and confirm the cost delta, then open a merge-ready PR with green CI.

## Merge-ready PR shepherding

Prefer the `pr-ready` skill — it pins the real CI gates and the rebase-safety steps.
Manual mandate when you want it explicit:
> Get this PR merge-ready: snapshot the branch tip first, rebase onto `origin/main`, resolve
> conflicts, verify no commits were stripped via `git reflog`, run `bun run lint && bun run typecheck`
> plus the relevant test buckets, add a changeset if a release surface changed, push with
> `--force-with-lease`, then confirm every gating job is green via `gh pr checks`. Only then call it merge-ready.

## Ambitious autonomous loops

Larger missions to delegate as models strengthen. Each is token-intensive — scope and budget deliberately.

### Self-healing PR pipeline
> Act as an autonomous PR maintainer for my open PRs. For each: (1) snapshot all commit SHAs
> to a recovery log before touching anything, (2) rebase onto `origin/main` and resolve conflicts,
> (3) run the local gate (`bun run lint`, `bun run typecheck`, affected test buckets) and fix
> failures including SSR/build breaks, (4) fetch and address review comments, (5) loop until
> `gh pr checks` is green and the PR is mergeable. Use `git reflog` to recover if a rebase strips
> commits. Report a status table of every PR and only stop for genuinely ambiguous design tradeoffs.

### Parallel cost-optimized infra migration
> Spin up parallel agents to evaluate cheaper inference infra. Each agent benchmarks one
> candidate (GPU tier / provider / region), verifying numerical correctness against a golden
> reference (require correlation = 1.0) and computing cost-per-1k-inferences. Aggregate into a
> decision matrix, pick the cheapest config that passes correctness, and open one merge-ready PR
> with the benchmark table and tradeoffs in the description.

### Overnight E2E sweep-to-fix loop
> Run the `abadge-e2e-sweep` skill across all surfaces, then enter a fix loop: triage every
> catalogued issue by severity, dispatch a fix per issue, and re-run the affected E2E tests after
> each fix until the sweep reports zero open issues. Use browser DOM tools (not screenshots) to
> verify UI fixes. Group fixes into logical stacked PRs and leave a morning report with the final
> clean sweep result and links to each PR.
