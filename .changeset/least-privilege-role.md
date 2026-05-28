---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Add the least-privilege application database role policy (AB-0012). `packages/db/least-privilege.sql` provisions `app_runtime` — a `NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB` role with DML-only access and `UPDATE`/`DELETE`/`TRUNCATE` revoked on `audit_logs`, closing the TRUNCATE gap the `0018` immutability trigger cannot (TRUNCATE bypasses row-level triggers) and keeping the AB-0011 RLS backstop enforceable. An integration test proves the policy against an ephemeral role, and a runbook documents PlanetScale provisioning + connection cutover. The role is provisioned out-of-band by the database owner; this PR adds no runtime behavior change.
