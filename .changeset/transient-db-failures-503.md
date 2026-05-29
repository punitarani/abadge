---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Map transient database failures to a retryable HTTP 503 (`ServiceUnavailableError`) on both the tRPC and v1 REST surfaces, instead of an opaque 500 — clients get a `Retry-After` backpressure signal and capacity blips stop being misclassified as 500-class bugs. Detection reads the SQLSTATE/socket code through Drizzle's `.cause` wrapper (connection class `08`, `53300`/`53400`, `57014`, `57P0x`, socket codes); genuine application errors (e.g. `23505` unique_violation) still map to 500 and never leak constraint names. The transient code is logged server-side (code only, never the message) so a recurring fault stays diagnosable. cli/mcp patch — release-surface dependency closure (both depend on `@abadge/core` + `@abadge/trpc`); no direct CLI/MCP behavior change.
