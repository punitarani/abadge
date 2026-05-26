---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Wire the per-profile DEK envelope into server-managed items (AB-0030 implementation). New server-managed writes now encrypt content under a per-profile DEK (v3) instead of directly under the master `ENCRYPTION_KEY`; the DEK is provisioned on a profile's first v3 write and wrapped by the master key. All decrypt paths (owner reveal, agent reveal/read, mount pipeline) branch on `serverKeyVersion` via a single `server-envelope` helper, so existing v1/v2 rows decrypt unchanged. This narrows a master-key disclosure's blast radius to a single profile and makes `ENCRYPTION_KEY` rotation a per-profile DEK rewrap with zero content re-encryption. Adds the `profiles.server_wrapped_dek` column (migration).
