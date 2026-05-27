---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Agent records, permission grants, and audit entries can now carry a null actor-user.

§AB-0043 makes an agent's lifecycle org-scoped rather than tied to its creating user: deleting that user now orphans the agent — along with its grants and sessions — instead of cascade-deleting them. As a result, three public types gain nullable fields: `Agent.createdBy`, `Permission.grantedBy`, and `AuditEntry.userId` are now `string | null`. Code that assumed these were always present (e.g. `agent.createdBy.slice(...)`) must handle the orphaned/ownerless case.
