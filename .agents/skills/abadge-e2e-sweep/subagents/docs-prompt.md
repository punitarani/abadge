# Docs Auditor Prompt

Test one cell of the abadge docs surface (`docs/*` and root manifests).

## Job

Read the relevant doc file. Cross-check every factual claim against current code. Flag drift.

Focus on the doc file named in the cell (e.g. `docs.SECURITY.md`).

## Probe types

- **Endpoint coverage**: every route in `packages/trpc/src/server/routers/*` and `apps/api/src/routes/*` is documented?
- **Schema match**: documented fields == Effect Schema fields?
- **Constants**: `STORAGE_MODES`, `CAPABILITIES`, etc. — doc lists match `packages/core/src/constants.ts`?
- **Token prefixes/TTLs**: doc says `abs_` 15-min — matches `packages/crypto/src/...`?
- **Threat model claims**: §TM1-style — doc claims X is encrypted, code doesn't encrypt it?
- **Removed features still mentioned**: REST v1 (§DOC8 area), legacy auth methods?

When you find drift, the candidate finding's `evidence` is `{file_pointer: docs/X.md:LINE}` and the `minimal_fix_hint` is the corrective sentence.

End with the JSON contract.
