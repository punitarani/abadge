# Web Tester Prompt

You are testing one cell of the abadge web dashboard (Next.js App Router, port 3000) using a browser automation MCP.

## Tooling

Prefer the Playwright MCP if connected (`mcp__plugin_playwright_playwright__*`). Fallback to Chrome DevTools MCP (`mcp__plugin_chrome-devtools-mcp_chrome-devtools__*`). Cell `requires` field will indicate which is needed; don't substitute one for the other if the cell specifies.

## Context

- Dashboard pages: `/register`, `/login`, `/onboarding`, `/overview`, `/items`, `/items/[id]`, `/profiles/[id]`, `/agents`, `/permissions`, `/audit`, `/settings/*`, `/invite/accept`.
- Org-store persisted in `localStorage` under `abadge-org` key — known to bleed across users (§W4).
- Onboarding writes `abadge_onboarding_*` keys — known to block new signups if stale (§ON1).
- Profile-detail page has 5 dead buttons (no `onClick`) — §W2.
- `/agents` and `/permissions` modals miss `x-abadge-org-id` on mutations → silent 400 (§W19).
- `/terms` and `/privacy` are 404 but linked from register consent (§W17/§W18).
- `/support` and `/feedback` are 404 but linked from sidebar (§W1).

## What to probe (by facet)

**happy**: navigate, perform the cell's action, assert expected post-state (URL, visible text, network 2xx).

**adversarial**:
- XSS in user-input fields (org name, item name, agent name, profile name).
- Navigate with a stale `localStorage.abadge-org` from another user's id (`§W4`).
- Click a known-dead button — does the modal even open? Does it log to console?
- Click "submit" on the onboarding step 2 with the server_managed radio selected — does the resulting profile actually have `storageMode: server_managed`? (Use `evaluate_script` to query `document.cookie` then API GET `/trpc/profiles.list`.)

**edge**: navigate with bad query string, broken cookie, slow network (use Playwright's network throttling), middle-of-typing form abandonment, double-click submit (idempotency), browser back during async flow.

**regression**: re-perform the §CODE's repro from `state/repros/<code>.md` if present.

## Useful snippets

Navigate + screenshot:
```
browser_navigate to http://localhost:3000/items
browser_snapshot   # accessibility tree, more reliable than screenshot
browser_take_screenshot  # for visual evidence in repro
```

Inspect localStorage:
```
browser_evaluate "Object.keys(localStorage).map(k=>[k,localStorage[k]])"
```

Watch network requests for silent 400s:
```
browser_network_requests   # after the click
# Filter for status >= 400
```

## Specific landmines

- The `localStorage` bleed (§W4) only manifests across user logins in the **same browser context**. Use Playwright's storage-state sharing or two browser tabs to reproduce.
- `/onboarding` step 2 always logs a 409 to console (§UX1) — do NOT flag this as a new finding unless the cell is explicitly about it; it's known and benign.
- The dashboard's item-detail page renders plaintext ONLY for personal accounts (the owner's own vault, via a Reveal control). In team organizations it stays in custody mode and never shows secret values — don't expect to see secrets there.
- Server-managed item creation goes through the SAME §I2 envelope decoder as API access — flag any plaintext JSON-stringified envelope leaking into reveal as `regression-§I2-via-web`.

## Closing

End with the JSON object per `references/subagent-contract.md`.
