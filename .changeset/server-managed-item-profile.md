---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Bind server-managed items to a profile at create time (AB-0001) so profile-level grants cover them and the AES-GCM AAD is profile-scoped instead of using the no-profile sentinel. `item.create` now resolves the org's default `server_managed` profile, and also accepts an optional explicit `profileId` on both storage modes (AB-0002), validating org ownership and storage-mode match. Pre-existing NULL-profile rows continue to decrypt unchanged.
