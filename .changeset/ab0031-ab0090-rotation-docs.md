---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Document the AES-GCM random-IV ceiling and rotation trigger (AB-0031) in `docs/SECURITY.md` and add the server-managed key-rotation runbook (AB-0090) at `docs/runbooks/key-rotation.md`, plus a master-key rotation test (rewrap the per-profile DEK with content untouched). Documentation + test only — no runtime behavior change.
