---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Add the least-privilege application database role policy (AB-0012). `packages/db/least-privilege.sql` provisions `abadge_app` — a NOSUPERUSER/NOBYPASSRLS role the application runtime connects as, with DML-only rights and no UPDATE/DELETE/TRUNCATE on `audit_logs` (the TRUNCATE revoke closes the gap the `0018` immutability trigger cannot, since TRUNCATE bypasses row-level triggers). Ships with an enforcement test and a production provisioning/cutover runbook. No code-path change; this is a deployment-hardening policy for operators.
