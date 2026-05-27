---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Add a Postgres row-level-security backstop (AB-0011) behind the AB-0010 scoped DAL. Migration `0021` enables FORCE RLS on `items`/`profiles`/`agents`/`permissions` with an org-isolation policy keyed on the `app.current_org` GUC, which `scopedDb.run()` sets via a transaction-local `set_config` as the first statement of every scoped transaction. The policy fails closed: an unset/wrong context yields zero rows, never an unfiltered leak. RLS enforces for the NOSUPERUSER/NOBYPASSRLS runtime role (AB-0012); the superuser/owner is unaffected, so migrations and admin tooling are unchanged. No behavior change for the current connection.
