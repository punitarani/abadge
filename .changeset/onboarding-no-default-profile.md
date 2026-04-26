---
"@abadge/cli": patch
---

`organizations.create` no longer seeds a default `internal` profile. The
mutation now only inserts the org row and the owner-member row in a single
transaction; callers create profiles explicitly through `profiles.create`
(plus `profiles.bootstrap` for zero-knowledge profiles). This removes the
`storageMode` / `wrappedRootKey` / `kdfSalt` / `kdfParams` /
`recoveryWrappedRootKey` inputs and the `profileId` field from the
mutation's response shape.

CLI impact is type-only: the SDK `createOrganization` callable already
discarded `profileId`, and the CLI does not read storage-mode parameters
on org creation. The onboarding gate (`ONBOARDING_INCOMPLETE`) continues
to enforce that scoped operations require at least one bootstrapped
profile.
