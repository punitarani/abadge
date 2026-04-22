# Wave 1 — Surface auditor guidance

Appended to the envelope. You are one of 11 surface auditors. Your job is to deeply understand ONE package/layer and confirm or refute every invariant that layer owns.

## Methodology

1. **Inventory.** `Glob` every file in your scope. List them in your notes file with one-line purpose each.
2. **Map.** Trace the primary data flows through your scope. For each entry point (route, socket handler, CLI command, MCP tool, exported function) identify: who calls it, what it does, what state it mutates, what crosses a trust boundary.
3. **Invariant check.** Pull every invariant from `AGENTS.md` "Non-negotiable invariants" and `docs/SECURITY.md` that TOUCHES your scope. For each:
   - State the invariant in your notes
   - Cite the code that upholds or violates it
   - Verdict: `held` / `violated` / `out-of-scope-for-this-layer`
4. **Vulnerability classes.** Apply the hunt list below systematically. Each class → either a finding (with file:line) or a negative result note.
5. **Drift check.** Compare what the code does to what `docs/` says it does. File Informational findings for drift.

## Classes to hunt

- Missing auth check on a privileged handler
- Missing permission/capability check on a secret-touching code path
- Missing org filter on a query (cross-org IDOR)
- Silent catch-all error handlers that swallow security-relevant errors
- Constant-time vs. non-constant-time comparisons on secret material
- Missing AAD on AEAD encrypt/decrypt
- Nonce derivation that could collide
- Persistent disk write of any secret material
- `any` types crossing a trust boundary
- Input schemas that use `.passthrough()` or strip-mode where they should be strict
- Cache-Control missing on secret-bearing responses
- Headers set only sometimes
- Cookie flags less strict than required
- Supply chain: "latest" version specifiers, unpinned GitHub Actions, workspace dependencies on private packages

## What to write in notes/

Use this structure:

```markdown
# Surface audit notes: <surface>

**Auditor:** {{agent_id}}
**Scope:** {{scope}}
**Files reviewed:** N

## Inventory

(table: file, purpose, LOC)

## Trust boundaries touched

- <boundary 1>: <what crosses it, what's sanitised where>
- <boundary 2>: ...

## Invariants tested

| Invariant | Verdict | Code reference |
|---|---|---|
| <inv text> | held | file:line |
| ... | violated | file:line → see finding {{agent_id}}-001 |

## Findings filed

- {{agent_id}}-001 (sev) — title
- {{agent_id}}-002 (sev) — title

## Negative results

- Tried X (CWE-NNN): searched for Y in file pattern Z, found nothing because <specific mechanism that prevents it>.
- Tried A: same.

## Verified-Fixed items

- <prior-id>: still fixed, confirmed at file:line
```

## Wave 1 closing note

Keep the notes file comprehensive — Wave 2 threat auditors will use it as their primary input for your surface. If your notes are thin, Wave 2 can't do its job.
