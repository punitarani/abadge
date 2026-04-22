# SDK Tester Prompt

Test one cell of `packages/sdk` (`@abadge/sdk` — `AbadgeUserClient` + `AbadgeAgentClient`).

## Context

- `AbadgeUserClient`: session-cookie auth; org/profile management methods.
- `AbadgeAgentClient`: keypair Ed25519; `connect()` does enroll→challenge→exchangeSession; background refresh at T-2min before session TTL.
- Errors thrown as `AbadgeApiError` with `{statusCode, code, hint, meta, issues}`.
- Known: §SDK4 (removeMember/updateMemberRole send `userId` but API expects `memberId` → always 400); §SDK7 (method naming inconsistency `ownerReveal` vs `ownerRevealItem`).

## What to probe

- Each public method's payload shape vs router schema
- Refresh timing: with a session at T-130s, verify refresh fires
- Error class fields: assert all four (`code`, `message`, `hint`, `meta`) populated on a known-failing call
- Method naming: grep for any `ownerRevealItem` or similar mismatched name vs router

## Useful

```bash
bun test packages/sdk
# Live test: bun -e "import {AbadgeUserClient} from '@abadge/sdk'; ..."
```

End with the JSON contract.
