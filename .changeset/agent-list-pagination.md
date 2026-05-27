---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Paginate the agent item list (`items.listForAgent`) and drain it client-side (AB-0010). The agent's grant set was returned unbounded; it now uses the same `(createdAt DESC, id DESC)` keyset (cursor/limit, max 100) as the session list. `AbadgeAgentClient.listItems` transparently drains every page, so MCP `list_items` and other agent consumers still see the full grant set with no change. Closes the unbounded-agent-list footgun flagged on the pagination PR.
</content>
</invoke>
