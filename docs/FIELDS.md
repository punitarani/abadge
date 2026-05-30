# Field Delivery

Abadge items can contain multiple named fields. When accessing a secret, you can request a specific
field by name. The field delivery system selects the appropriate value from the item payload.

## Standard Fields by Item Kind

Items have a `kind` that determines which fields are expected in their payload.

| Kind | Standard Fields |
|------|----------------|
| `login` | `username`, `email`, `password`, `url`, `totp_secret` |
| `api_key` | `value`, `key_id`, `key_secret` |
| `token` | `value` |
| `json` | (user-defined; no standard fields) |
| `certificate` | `cert`, `key`, `chain`, `passphrase` |
| `ssh_key` | `private_key`, `public_key`, `passphrase` |
| `opaque` | `value` |

Source: `STANDARD_FIELDS_BY_KIND` in `packages/core/src/constants.ts`.

## Field Resolution Rules

Resolution is centralised in `resolveFieldValue` / `expandFieldSelection` in
`packages/core/src/secret-delivery.ts`. Only **string** fields are eligible; non-string values are ignored.

When `field` is **not** specified, the candidate set is computed in this order:

1. If the item's kind has standard fields and any of them are present in the payload, the candidate
   set is those present standard fields (in standard order).
2. Otherwise, if a `value` field is present, the candidate set is `["value"]`.
3. Otherwise, the candidate set is every string field in the payload.

The value is auto-delivered only when the candidate set resolves to exactly one field. If the set is
empty or contains more than one field, `MULTI_FIELD_ITEM` is returned with the available string
fields in `meta.availableFields`.

When `field` **is** specified:

1. The named field is looked up in the item payload.
2. If the field is not a string or does not exist, `FIELD_NOT_FOUND` is returned with the available
   string fields in `meta.availableFields`.

## Using Fields in the CLI

Use `--field` with `abadge run` or `abadge mount`:

```bash
# Run with just the password field from a login item
abadge run --item <id> --field password -- psql "$DB_HOST"

# Mount the private key field from an SSH key item
abadge mount --item <id> --field private_key
```

## Using Fields in the MCP

Pass the optional `field` parameter to `use_secret` or `mount_secret`:

```json
{
  "itemId": "item_abc123",
  "field": "password",
  "command": "psql",
  "args": ["$DB_HOST"]
}
```

## Using Fields in the SDK

Pass `field` as an option to `access.read`, or in the opts object to `access.use`:

```ts
// Read only the password field (server-managed item)
const result = await agent.access.read(itemId, { field: "password" });
if (result.storageMode !== "server_managed") throw new Error("Expected server_managed item");
const password = result.payload.fields.password;

// Mount the private_key field as a file
const { mountId } = await agent.access.use(
  { itemId },
  { delivery: "file", field: "private_key" },
);
```

## Multi-Field Item Error

When a field is required but not specified for a multi-field item, the API returns:

```json
{
  "code": "MULTI_FIELD_ITEM",
  "message": "This item has multiple fields. Specify which field to deliver.",
  "hint": "Available fields: username, password, url.",
  "meta": {
    "availableFields": ["username", "password", "url"]
  }
}
```

Inspect `meta.availableFields` to determine which field name to pass.

## Single-Field Auto-Delivery

For `opaque` and `token` items with a single `value` field, omitting `field` is safe — the value
is returned automatically without requiring an explicit field name.
