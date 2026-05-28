---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Add a "Personal account" choice to onboarding. A personal account is a hidden personal organization — a normal single-member org flagged via `organization.metadata` (`{"type":"personal"}`) — so it reuses all org-scoping, middleware, and audit paths with no schema migration. A new `organizations.createPersonal` procedure (no input) auto-generates a name/slug and seeds one default `server_managed` profile; `organizations.create`/`list`/`get` now carry an `isPersonal` flag. Personal accounts hold one profile by default (more allowed), can register many agents, and coexist with team orgs the user creates or joins later (rides on the existing `X-Abadge-Org-Id` resolution, so no agent-facing behavior changes).
