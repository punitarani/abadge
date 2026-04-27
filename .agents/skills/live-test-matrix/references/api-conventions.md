# tRPC API conventions

What the wire actually looks like, with the gotchas that bit during real runs.

## Wire format

**POST mutations** — `Content-Type: application/json`, body is the **plain input object**:

```bash
curl -X POST http://localhost:8787/trpc/permissions.create \
  -H "Authorization: Bearer $SESSION" \
  -H "X-Abadge-Org-Id: $ORG_ID" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"...","itemId":"...","capabilities":["mount_env"]}'
```

NO `{"json": {...}}` wrapper for non-batched calls — that was a tRPC v10 convention and produces `is unexpected, expected: ...keys` errors.

**GET queries** — pass `?input=<urlencoded JSON>`. Use curl `-G` + `--data-urlencode` to handle escaping:

```bash
curl -s -G http://localhost:8787/trpc/permissions.list \
  -H "Authorization: Bearer $SESSION" \
  -H "X-Abadge-Org-Id: $ORG_ID" \
  --data-urlencode 'input={"agentId":"...","itemId":"..."}'
```

## Required headers

| Header | When |
|---|---|
| `Authorization: Bearer <token>` | always (user session, agent legacy_api_key, or agent session token) |
| `X-Abadge-Org-Id: <org_id>` | required for `scopedSessionProcedure` always; required for `sessionProcedure` once the user has 2+ orgs |
| `Content-Type: application/json` | for POST bodies |

## Response shapes

**Success:**

```json
{ "result": { "data": { ... } } }
```

**Error:**

```json
{
  "error": {
    "message": "...",
    "code": -32600,
    "data": {
      "code": "BAD_REQUEST",
      "httpStatus": 400,
      "hint": "...",
      "meta": { ... }
    }
  }
}
```

The error path is **`.error.data.code`** — NOT `.error.json.data.code` (that's a different tRPC variant some references use). Some domain errors wrap the actual code at `.error.data.cause.code` — handle both:

```bash
err_code() {
  echo "$1" | jq -r '.error.data.code // .error.data.cause.code // "none"'
}
```

## Error codes you'll see

| Code | HTTP | Meaning |
|---|---|---|
| `UNAUTHORIZED` | 401 | bad/missing token |
| `FORBIDDEN` | 403 | authed but not authorized |
| `PERMISSION_DENIED` | 403 | at access time — no matching permission row |
| `ITEM_NOT_FOUND` | 404 | item doesn't exist or isn't in caller's org |
| `AGENT_NOT_FOUND` | 404 | agent doesn't exist or isn't in caller's org |
| `BAD_REQUEST` | 400 | schema validation failure |
| `ORG_HEADER_REQUIRED` | 400 | multi-org user, no `X-Abadge-Org-Id` header |
| `ONBOARDING_INCOMPLETE` | 403 | org has no bootstrapped profile |
| `INVALID_CAPABILITY_LOCALITY` | 400 | matrix violation: locality side |
| `INVALID_CAPABILITY_STORAGE` | 400 | matrix violation: storage side |
| `PERMISSION_ALREADY_EXISTS` | 409 | duplicate `(agent, item, capability)` |
| `RATE_LIMITED` | 429 | over the 100 req/min limit |

Full list in `docs/ERRORS.md`.

## Domain error meta

Many errors carry rich `meta` with diagnostic detail. For example:

```json
{
  "error": {
    "data": {
      "code": "INVALID_CAPABILITY_STORAGE",
      "meta": { "invalidCapabilities": ["read_ciphertext"] }
    }
  }
}
```

The path is `.error.data.meta.<field>`. Always probe `meta` in adversarial assertions to lock the error shape, not just the code.

## items.create gotcha

`storageMode: "server_managed"` body is `{storageMode, payload}` — NO `profileId`. SM items get `profile_id=NULL` by default. To bind to a specific profile for cross-profile testing, UPDATE the row in the DB:

```bash
psql -c "UPDATE items SET profile_id='$PROFILE_ID' WHERE id='$ITEM_ID';"
```

But beware: AAD binds `(orgId, profileId, itemId, keyVersion)` into the AES-GCM ciphertext at encrypt time. UPDATEing `profile_id` after creation breaks decrypt with `INTERNAL_SERVER_ERROR/500`. This is **defence-in-depth** and worth a pentest, but it means your sanity-decrypt check should leave `profile_id=NULL` for the item being decrypted.

ZK items use a different create shape (`{storageMode: "zero_knowledge", id, label, encryptedItemKey, ciphertext}`) where the client supplies the `id` because it's bound into the AAD at encrypt time.

## item kinds

Fixed enum: `login`, `api_key`, `token`, `json`, `certificate`, `ssh_key`, `opaque`. See `STANDARD_FIELDS_BY_KIND` in `packages/core/src/constants.ts`. Use `kind: "token"` + `fields: {value: "..."}` for the simplest test items — fewest required fields, fastest to construct.
