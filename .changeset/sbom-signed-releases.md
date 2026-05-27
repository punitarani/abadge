---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Sign release binaries and publish a CycloneDX SBOM (AB-0102). Each GitHub release now attaches, per binary, a keyless cosign signature bundle (`*.cosign.bundle`) and a CycloneDX SBOM of the dependency closure alongside the existing `SHA256SUMS`. Signing runs under GitHub OIDC (Fulcio/Rekor) and the release fails if signing fails. Verify a download with `cosign verify-blob --bundle <artifact>.cosign.bundle --certificate-identity 'https://github.com/punitarani/abadge/.github/workflows/release.yml@refs/heads/main' --certificate-oidc-issuer https://token.actions.githubusercontent.com <artifact>`.
