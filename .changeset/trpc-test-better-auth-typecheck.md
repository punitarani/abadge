---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Internal: fix a latent type error in the `@abadge/trpc` test helpers. `better-auth` is a phantom dependency there (declared by `@abadge/auth`, not `@abadge/trpc`), so `betterAuth` and `drizzleAdapter` instantiated incompatible `BetterAuthOptions` and the adapter no longer unified with the `database` field after the better-auth 1.5.6 bump. CI was masking this via a stale Turbo typecheck cache; a fresh `turbo typecheck` failed. Anchored the cast to the `database` field type at both call sites (runtime usage matches `@abadge/auth`'s production wiring). No runtime change.
