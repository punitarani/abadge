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

When `field` is not specified:

1. If the item has exactly one string field, that field is returned automatically.
2. If the item kind has standard fields, the first standard field present in the payload is used.
   If only one standard field is present, it is returned. If multiple standard fields are present,
   `MULTI_FIELD_ITEM` is returned.
3. If neither rule produces a single field, `MULTI_FIELD_ITEM` is returned with the available
   fields listed in the error hint.

When `field` is specified:

1. The named field is looked up in the item payload.
2. If the field is not a string or does not exist, `FIELD_NOT_FOUND` is returned with available
   fields in the hint.

## Using Fields in the CLI

Use `--field` with `abadge run` or `abadge mount`:

```bash
# Run with just the password field from a login item
abadge run --item <id> --field password -- psql "$DB_HOST"

# Mount the private key field from an SSH key item
abadge mount --item <id> --field private_key
```

## Using Fields in the MCP

Pass the optional `field` parameter to `run_with_secret` or `mount_secret`:

```json
{
  "itemId": "item_abc123",
  "field": "password",
  "command": "psql",
  "args": ["$DB_HOST"]
}
```

## Using Fields in the SDK

Pass `field` as the second argument to `accessReveal`, or third argument to `accessMount`:

```ts
// Reveal only the password field
const result = await agent.accessReveal(itemId, "password");

// Mount the private_key field as a file
const mounted = await agent.accessMount(itemId, "file", "private_key");
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
