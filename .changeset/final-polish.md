---
"@abadge/mcp": patch
---

mcp: on a failed `use_secret` run that produced (withheld) output, return a static, secret-free `hint` explaining that stdout/stderr were suppressed per RED1 and pointing at `mount_secret` for output inspection. The hint is a fixed constant containing no subprocess output, and is omitted entirely on success.
