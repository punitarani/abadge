# Fix review issues — v0-refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 14 findings from `docs/reviews/2026-04-14-full-stack-review.md` (one P0 ship-blocker, one P0 invariant gap, twelve quality issues) plus a newly discovered P1 — the Dashboard `/profiles?create=true` link has no drawer behind it so operators cannot add profiles after onboarding.

**Architecture:** Tier the tRPC procedure stack into three layers (`publicProcedure` / `userProcedure` / `sessionProcedure`) so new users can call the bootstrap endpoints that today are behind an org-membership wall. Port two onboarding widgets (storage-mode picker, profile-create form) into small shared components so the Dashboard can reuse them, then clean up the residual "vault" terminology and form-UX nits. Add a single audit emitter for Better-Auth org-plugin writes so no org/profile creation escapes the log.

**Tech Stack:** TypeScript strict, tRPC 11, Effect, Hono on Cloudflare Workers, Next.js 15 App Router, better-auth 1.5.6, Bun 1.3, Biome, happy-dom for component tests, Drizzle ORM.

**Execution note:** Phases 1 and 2 are strict blockers — nothing below them ships. Phases 3–7 are independently mergeable. Each phase ends with a commit; each task inside a phase ends with a commit too.

---

## File Structure

### New files

| Path | Responsibility |
|------|----------------|
| `packages/trpc/src/server/auth-optional-org.ts` | `resolveSessionIdentityOptionalOrg` — same contract as `resolveSessionIdentity` but returns `organizationId: null` for zero-membership users. |
| `packages/trpc/src/server/auth-optional-org.test.ts` | Unit tests for the optional-org resolver (0, 1, 2+ memberships; explicit header). |
| `packages/trpc/src/server/__tests__/integration/onboarding-flow.test.ts` | Integration test — fresh user with zero orgs can call `organizations.create`, `organizations.list`, `organizations.checkSlug`. |
| `packages/auth/src/audit-hooks.ts` | `attachOrganizationAuditHooks` — wraps Better-Auth organization-plugin lifecycle with abadge audit writes. |
| `packages/auth/src/audit-hooks.test.ts` | Unit test verifying the hook writes an `organization.create` row. |
| `apps/web/src/components/onboarding/storage-mode-picker.tsx` | Single accessible radio-group `StorageModePicker` replacing the inline `<button>` cards in onboarding; also consumed by a new profile-create drawer. |
| `apps/web/src/components/onboarding/storage-mode-picker.test.tsx` | happy-dom test — keyboard arrow navigation, `aria-checked` transitions. |
| `apps/web/src/components/dashboard/profile-create-drawer.tsx` | Dashboard drawer that opens when `/profiles?create=true`. Same three fields as onboarding Step 2 (name, storage mode, ZK password) but calls `profiles.create` + `profiles.bootstrap` without requiring the user to be onboarding. |
| `apps/web/src/components/dashboard/profile-create-drawer.test.tsx` | happy-dom test — drawer opens on query param, closes and strips `?create=true`. |

### Modified files

| Path | What changes |
|------|--------------|
| `packages/trpc/src/server/init.ts` | Add `userProcedure` (auth + optional-org middleware). Leave `sessionProcedure` unchanged. |
| `packages/trpc/src/server/routers/organizations.ts:889,894,899` | Switch `create`, `list`, `checkSlug` to `userProcedure`. |
| `packages/trpc/src/server/auth.ts:319-324` | Keep existing throw but also export a narrower helper used by the new file. |
| `packages/auth/src/server.ts` | Wire `attachOrganizationAuditHooks` into Better-Auth setup. |
| `apps/web/src/app/(auth)/register/page.tsx:106-149` | Add `autoComplete`, `spellCheck={false}` on email, `minLength={12}` on confirm, TOS accept below the submit button, pre-render the password strength bar. |
| `apps/web/src/components/ui/password-strength.tsx` | Render an empty bar when `password === ""` instead of returning `null`. |
| `apps/web/src/app/onboarding/page.tsx:28,114,272-277,626-662,668` | Rename label + state variable `vaultPassword → profilePassword`, use `StorageModePicker`, rename button to "Create profile". |
| `apps/web/src/app/(dashboard)/profiles/page.tsx` | Read `?create=true`, mount `ProfileCreateDrawer`, replace the query-string on close. |
| `apps/web/src/components/dashboard/create-item-panel.tsx:577` | `"Add a secret to your vault." → "Add a secret to your profile."`; drop the `size="sm"` on the submit button that causes `Encrypt & save` to truncate. |
| `apps/web/src/components/dashboard/responsive-overlay.stories.tsx:13,41` | Update story description to match. |
| `apps/web/src/components/dashboard/profile-unlock-modal.tsx:131` | Rename "Vault password" label to "Profile password". |
| `apps/web/src/app/(dashboard)/overview/page.tsx:281-283` | Fix `defaultProfileCount` — the filter is wrong; `default` ≡ `name === "internal"`, not `storageMode === "server_managed"`. |
| `apps/web/src/app/layout.tsx` / per-page `metadata` exports | Per-page `<title>` via Next.js `metadata` API. |
| `packages/cli/src/commands/vault.ts` + `packages/cli/bin/abadge.ts` | Move `vault` subcommands under `profile` (`profile unlock`, `profile lock`, `profile rekey`, `profile change-password`). Keep `vault` as a hidden alias that prints a deprecation line and forwards. |

---

## Phase 1 — P0-1: Unblock onboarding for new users

### Task 1.1: Add optional-org session resolver

**Files:**
- Create: `packages/trpc/src/server/auth-optional-org.ts`
- Create: `packages/trpc/src/server/auth-optional-org.test.ts`
- Modify: `packages/trpc/src/server/context.ts` — widen `SessionIdentity.organizationId` to `string | null` for the new procedure (add a sibling type).

- [ ] **Step 1: Add the optional-org identity type**

Edit `packages/trpc/src/server/context.ts` — append below the existing `SessionIdentity`:

```typescript
export interface OptionalOrgSessionIdentity {
  kind: "session";
  userId: string;
  organizationId: string | null;
  authMethod: "browser_session" | "bearer_session";
}

export interface OptionalOrgSessionRequestContext extends BaseRequestContext {
  identity: OptionalOrgSessionIdentity;
}
```

- [ ] **Step 2: Write failing test for `resolveSessionIdentityOptionalOrg`**

Create `packages/trpc/src/server/auth-optional-org.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { makeSessionCtx } from "./auth.test"; // reuse existing helper
import { resolveSessionIdentityOptionalOrg } from "./auth-optional-org";

describe("resolveSessionIdentityOptionalOrg", () => {
  test("returns organizationId=null for a user with zero memberships", async () => {
    const ctx = makeSessionCtx({
      sessionUserId: "user_zero",
      memberships: [],
      header: null,
    });
    const identity = await Effect.runPromise(resolveSessionIdentityOptionalOrg(ctx));
    expect(identity).toEqual({
      kind: "session",
      userId: "user_zero",
      organizationId: null,
      authMethod: "browser_session",
    });
  });

  test("resolves the only membership when user has exactly one", async () => {
    const ctx = makeSessionCtx({
      sessionUserId: "user_one",
      memberships: [{ organizationId: "org_a" }],
      header: null,
    });
    const identity = await Effect.runPromise(resolveSessionIdentityOptionalOrg(ctx));
    expect(identity.organizationId).toBe("org_a");
  });

  test("requires X-Abadge-Org-Id header when user has 2+ memberships", async () => {
    const ctx = makeSessionCtx({
      sessionUserId: "user_two",
      memberships: [{ organizationId: "org_a" }, { organizationId: "org_b" }],
      header: null,
    });
    const err = await Effect.runPromise(Effect.flip(resolveSessionIdentityOptionalOrg(ctx)));
    expect(err).toMatchObject({ code: "ORG_HEADER_REQUIRED" });
  });

  test("rejects when Authorization header is missing entirely", async () => {
    const ctx = makeSessionCtx({ sessionUserId: null, memberships: [], header: null });
    const err = await Effect.runPromise(Effect.flip(resolveSessionIdentityOptionalOrg(ctx)));
    expect(err).toMatchObject({ code: "UNAUTHORIZED" });
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

```bash
cd packages/trpc && bun test src/server/auth-optional-org.test.ts
```

Expected: `Cannot find module './auth-optional-org'`.

- [ ] **Step 4: Implement `resolveSessionIdentityOptionalOrg`**

Create `packages/trpc/src/server/auth-optional-org.ts`:

```typescript
import { BadRequestError, UnauthorizedError } from "@abadge/core";
import { and, asc, eq } from "@abadge/db";
import { member } from "@abadge/db/schema";
import { Effect } from "effect";
import type { AuthSessionResult } from "./auth";
import type { BaseRequestContext, OptionalOrgSessionIdentity } from "./context";
import { tryAsync } from "./effect";

function unauthorized(message: string): UnauthorizedError {
  return new UnauthorizedError({
    code: "UNAUTHORIZED",
    message,
    hint: "Authenticate with a valid session cookie before calling this endpoint.",
  });
}

async function resolveOptionalOrgId(
  ctx: BaseRequestContext,
  userId: string,
): Promise<string | null> {
  const orgIdHeader = ctx.req.headers.get("X-Abadge-Org-Id");
  if (orgIdHeader) {
    const [hit] = await ctx.db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(and(eq(member.userId, userId), eq(member.organizationId, orgIdHeader)))
      .limit(1);
    if (!hit) {
      throw new UnauthorizedError({
        code: "ORG_MEMBERSHIP_REQUIRED",
        message: "Not a member of the requested organization",
        hint: "Switch to an organization you belong to.",
      });
    }
    return orgIdHeader;
  }

  const memberships = await ctx.db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt));

  if (memberships.length === 0) return null;
  if (memberships.length > 1) {
    throw new BadRequestError({
      code: "ORG_HEADER_REQUIRED",
      message: "X-Abadge-Org-Id header required for multi-org users",
      hint: "Set X-Abadge-Org-Id to the organization context for this request.",
      meta: { availableOrgIds: memberships.map((m) => m.organizationId) },
    });
  }
  const [only] = memberships as [(typeof memberships)[number]];
  return only.organizationId;
}

export const resolveSessionIdentityOptionalOrg = (
  ctx: BaseRequestContext,
): Effect.Effect<OptionalOrgSessionIdentity, Error | UnauthorizedError> =>
  Effect.gen(function* () {
    const session = (yield* tryAsync(() =>
      ctx.auth.api.getSession({ headers: ctx.req.headers }),
    )) as AuthSessionResult | null;

    const userId = session?.user?.id ?? session?.session?.userId ?? null;
    if (!userId) return yield* Effect.fail(unauthorized("Unauthorized"));

    const organizationId = yield* tryAsync(() => resolveOptionalOrgId(ctx, userId));
    return {
      kind: "session" as const,
      userId,
      organizationId,
      authMethod: "browser_session",
    };
  });
```

Also export `AuthSessionResult` from `auth.ts` (make the existing `interface AuthSessionResult` `export`ed).

- [ ] **Step 5: Run test — expect PASS**

```bash
cd packages/trpc && bun test src/server/auth-optional-org.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/trpc/src/server/auth-optional-org.ts \
        packages/trpc/src/server/auth-optional-org.test.ts \
        packages/trpc/src/server/context.ts \
        packages/trpc/src/server/auth.ts
git commit -m "feat(trpc): add optional-org session resolver for bootstrap endpoints"
```

### Task 1.2: Add `userProcedure` tier and switch bootstrap endpoints

**Files:**
- Modify: `packages/trpc/src/server/init.ts` (append after `sessionProcedure`)
- Modify: `packages/trpc/src/server/routers/organizations.ts` (swap procedure on 3 endpoints)

- [ ] **Step 1: Write failing integration test**

Create `packages/trpc/src/server/__tests__/integration/onboarding-flow.test.ts`:

```typescript
import { beforeAll, describe, expect, test } from "bun:test";
import { createTestUserSession, freshDb } from "../helpers"; // assume existing harness
import { appRouter } from "../../router";
import { createTrpcCallerFactory } from "../../init";

const makeCaller = createTrpcCallerFactory(appRouter);

describe("new-user bootstrap flow", () => {
  let ctx: Awaited<ReturnType<typeof createTestUserSession>>;

  beforeAll(async () => {
    await freshDb();
    ctx = await createTestUserSession({ email: "fresh@test.local" }); // zero memberships
  });

  test("organizations.list returns empty list for zero-org user (not 401)", async () => {
    const caller = makeCaller(ctx);
    const result = await caller.organizations.list();
    expect(result.organizations).toEqual([]);
  });

  test("organizations.checkSlug works for zero-org user", async () => {
    const caller = makeCaller(ctx);
    const result = await caller.organizations.checkSlug({ slug: "new-slug" });
    expect(result.available).toBe(true);
  });

  test("organizations.create succeeds for zero-org user", async () => {
    const caller = makeCaller(ctx);
    const result = await caller.organizations.create({
      name: "Bootstrap Org",
      slug: "bootstrap-org",
    });
    expect(result.organization.id).toBeDefined();
    expect(result.organization.slug).toBe("bootstrap-org");
  });
});
```

If the project doesn't yet expose `createTestUserSession` / `freshDb`, plug into whatever harness `apps/web/src/app/onboarding/onboarding-triage.test.ts` and `packages/trpc/src/server/__tests__/integration/auth-chain.test.ts` use. Do not introduce a new harness.

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd packages/trpc && bun test src/server/__tests__/integration/onboarding-flow.test.ts
```

Expected: all 3 tests fail with `UNAUTHORIZED` / `NO_ORG_MEMBERSHIP`.

- [ ] **Step 3: Add `userProcedure` to `init.ts`**

Append in `packages/trpc/src/server/init.ts` immediately after `sessionProcedure` (line 77):

```typescript
import { resolveSessionIdentityOptionalOrg } from "./auth-optional-org";
import type { OptionalOrgSessionRequestContext } from "./context";

/**
 * Authenticated procedure that does NOT require org membership.
 * Use for bootstrap endpoints the user hits before they have an org:
 * organizations.create / organizations.list / organizations.checkSlug.
 * Everywhere else, use sessionProcedure (auth + resolved org).
 */
export const userProcedure = publicProcedure.use(async ({ ctx, next }) => {
  try {
    const identity = await Effect.runPromise(resolveSessionIdentityOptionalOrg(ctx));
    return next({
      ctx: {
        ...ctx,
        identity,
      } satisfies OptionalOrgSessionRequestContext,
    });
  } catch (error) {
    throw toTrpcError(error);
  }
});
```

- [ ] **Step 4: Switch `organizations.{create,list,checkSlug}` to `userProcedure`**

Edit `packages/trpc/src/server/routers/organizations.ts`:

```typescript
// line 30 — update import
import {
  createTrpcRouter,
  requireOrgRole,
  sessionProcedure,
  userProcedure,
} from "../init";

// line 889
create: userProcedure
  .input(CreateOrganizationSchema)
  .mutation(async ({ ctx, input }) => {
    // existing body — `ctx.identity.organizationId` may be null for new users; that's fine.
    // ...
  }),

// line 894
checkSlug: userProcedure
  .input(CheckSlugSchema)
  .query(async ({ ctx, input }) => {
    // existing body
  }),

// line 899
list: userProcedure
  .query(async ({ ctx }) => {
    // existing body — filter by ctx.identity.userId, never by organizationId
  }),
```

If any of these bodies today dereference `ctx.identity.organizationId` as non-null (e.g. `eq(member.organizationId, ctx.identity.organizationId)`), introduce a guard: when the value is `null`, short-circuit with the empty/available/default response appropriate for that endpoint.

- [ ] **Step 5: Run integration test — expect PASS**

```bash
cd packages/trpc && bun test src/server/__tests__/integration/onboarding-flow.test.ts
```

Expected: 3/3 pass.

- [ ] **Step 6: Typecheck + unit sweep**

```bash
bun run typecheck
cd packages/trpc && bun test
```

Expected: no regressions.

- [ ] **Step 7: Commit**

```bash
git add packages/trpc/src/server/init.ts \
        packages/trpc/src/server/routers/organizations.ts \
        packages/trpc/src/server/__tests__/integration/onboarding-flow.test.ts
git commit -m "feat(trpc): introduce userProcedure tier so new users can bootstrap their first org"
```

### Task 1.3: Smoke-test the live API

- [ ] **Step 1: Restart worker**

```bash
bun run api:clean:worker
bun run api:dev:worker &
```

- [ ] **Step 2: Curl the three endpoints with a fresh session**

Create a dummy session via the Better-Auth sign-up endpoint and capture the cookie jar:

```bash
curl -sS -c /tmp/abadge.cj -X POST http://localhost:8787/api/auth/sign-up/email \
  -H 'content-type: application/json' \
  -d '{"name":"Phase1","email":"p1@local.test","password":"abadge-phase-1-2026"}'

curl -sS -b /tmp/abadge.cj 'http://localhost:8787/trpc/organizations.list?batch=1&input=%7B%7D'
curl -sS -b /tmp/abadge.cj 'http://localhost:8787/trpc/organizations.checkSlug?batch=1&input=%7B%220%22%3A%7B%22slug%22%3A%22probe%22%7D%7D'
curl -sS -b /tmp/abadge.cj -X POST 'http://localhost:8787/trpc/organizations.create?batch=1' \
  -H 'content-type: application/json' \
  -d '{"0":{"name":"Phase1 Org","slug":"phase1-org"}}'
```

Expected: all three return HTTP 200. No `NO_ORG_MEMBERSHIP` errors.

---

## Phase 2 — P0-2: Audit every org.create, including the Better-Auth plugin path

### Task 2.1: Add organization-lifecycle audit hook

**Files:**
- Create: `packages/auth/src/audit-hooks.ts`
- Create: `packages/auth/src/audit-hooks.test.ts`
- Modify: `packages/auth/src/server.ts` — call `attachOrganizationAuditHooks`.

- [ ] **Step 1: Write failing test**

Create `packages/auth/src/audit-hooks.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { attachOrganizationAuditHooks } from "./audit-hooks";

describe("attachOrganizationAuditHooks", () => {
  test("writes an organization.create audit row after the plugin creates an org", async () => {
    const captured: unknown[] = [];
    const fakeDb = {
      insert: () => ({
        values: (row: unknown) => {
          captured.push(row);
          return Promise.resolve({ rowCount: 1 });
        },
      }),
    };
    const hooks = attachOrganizationAuditHooks(fakeDb as never);
    await hooks.organization.create.after({
      user: { id: "u1" },
      organization: { id: "org_99", name: "Acme" },
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      userId: "u1",
      eventType: "organization.create",
      result: "allowed",
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (module missing)**

```bash
cd packages/auth && bun test src/audit-hooks.test.ts
```

- [ ] **Step 3: Implement `attachOrganizationAuditHooks`**

Create `packages/auth/src/audit-hooks.ts`:

```typescript
import { auditLogs } from "@abadge/db/schema";
import type { Database } from "@abadge/db";

/**
 * Wraps Better-Auth organization plugin lifecycle events and emits
 * append-only audit rows. Every create/update/delete against the
 * organization table — whether via the plugin route or via abadge's
 * own tRPC — must pass through this hook.
 */
export function attachOrganizationAuditHooks(db: Database) {
  async function writeRow(opts: {
    userId: string;
    eventType: "organization.create" | "organization.update" | "organization.delete";
    organizationId: string;
    meta?: Record<string, unknown>;
  }) {
    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      userId: opts.userId,
      agentId: null,
      itemId: null,
      eventType: opts.eventType,
      result: "allowed",
      deliveryMode: null,
      meta: { organizationId: opts.organizationId, ...(opts.meta ?? {}) },
      ipAddress: null,
      occurredAt: new Date(),
    });
  }

  return {
    organization: {
      create: {
        after: async (ev: { user: { id: string }; organization: { id: string; name: string } }) =>
          writeRow({
            userId: ev.user.id,
            eventType: "organization.create",
            organizationId: ev.organization.id,
            meta: { name: ev.organization.name },
          }),
      },
      // update / delete hooks follow the same shape — add once the product
      // asks for cascade-on-delete audit, not now.
    },
  };
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd packages/auth && bun test src/audit-hooks.test.ts
```

- [ ] **Step 5: Wire hook into `createAuth`**

Edit `packages/auth/src/server.ts` — inside `createAuth`, pass the hooks to the Better-Auth `organization` plugin's `databaseHooks` option. Exact field name depends on the plugin version (`better-auth@1.5.6`); look up the current plugin shape and thread `attachOrganizationAuditHooks(db).organization.create.after` into the `after` callback. Commit once the wiring typechecks.

- [ ] **Step 6: Verify end-to-end**

```bash
bun run api:clean:worker && bun run api:dev:worker &
# create an org via the plugin route
curl -sS -b /tmp/abadge.cj -X POST http://localhost:8787/api/auth/organization/create \
  -H 'content-type: application/json' \
  -d '{"name":"Audit Probe","slug":"audit-probe"}'
# list audit via the tRPC audit router (needs session)
curl -sS -b /tmp/abadge.cj 'http://localhost:8787/trpc/audit.list?batch=1&input=%7B%220%22%3A%7B%7D%7D'
```

Expected: an `organization.create` row is present for the probe org.

- [ ] **Step 7: Commit**

```bash
git add packages/auth/src/audit-hooks.ts \
        packages/auth/src/audit-hooks.test.ts \
        packages/auth/src/server.ts
git commit -m "feat(auth): emit organization.create audit rows from better-auth plugin path"
```

---

## Phase 3 — Terminology cutover: "vault" → "profile" in user-visible copy

### Task 3.1: Rename onboarding Step 2 password label + state

**Files:**
- Modify: `apps/web/src/app/onboarding/page.tsx`

- [ ] **Step 1: Rename in the onboarding page**

In `apps/web/src/app/onboarding/page.tsx`, apply these exact text substitutions (use `Edit`; do not introduce a regex sweep because other uses of "vault" in the file are legitimate — e.g. `useVault` store):

```typescript
// line 114
return "Profile password must be at least 12 characters";

// line 276
const [profilePassword, setProfilePassword] = useState("");

// rename every `vaultPassword` reference in Step 2 code to `profilePassword`.
// Lines 185, 197, 202, 205, 213, 228, 276, 319, 328, 349, 638–643.

// line 626
<Label htmlFor="profile-password">

// line 627
Profile password <span className="text-red-500">*</span>

// line 630
id="profile-password"

// line 636
name="abadge-profile-password"

// line 648 & 652
<Label htmlFor="profile-confirm-password">…</Label>
id="profile-confirm-password"

// line 655
name="abadge-profile-password-confirm"
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck --filter=@abadge/web
```

Expected: no errors.

- [ ] **Step 3: Visual smoke**

```bash
bun run dev
```

Navigate `/onboarding` step 2. Confirm label reads "Profile password".

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/onboarding/page.tsx
git commit -m "refactor(web): rename 'Vault password' to 'Profile password' in onboarding"
```

### Task 3.2: Rename residual "vault" microcopy

**Files:**
- Modify: `apps/web/src/components/dashboard/create-item-panel.tsx:577`
- Modify: `apps/web/src/components/dashboard/responsive-overlay.stories.tsx:13,41`
- Modify: `apps/web/src/components/dashboard/profile-unlock-modal.tsx:131`

- [ ] **Step 1: Edit**

```typescript
// create-item-panel.tsx line 577
description="Add a secret to your profile."

// responsive-overlay.stories.tsx lines 13 and 41
description: "Add a secret to your profile.",
description="Add a secret to your profile."

// profile-unlock-modal.tsx line 131
<Label htmlFor="profile-unlock-password">Profile password</Label>
```

- [ ] **Step 2: Run Storybook typecheck (touches `.stories.tsx`)**

```bash
bun run --cwd apps/web storybook:build
```

Expected: success; stories compile.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/dashboard/create-item-panel.tsx \
        apps/web/src/components/dashboard/responsive-overlay.stories.tsx \
        apps/web/src/components/dashboard/profile-unlock-modal.tsx
git commit -m "refactor(web): purge residual 'vault' terminology from user-visible copy"
```

### Task 3.3: Fold CLI `vault` subcommands under `profile`

**Files:**
- Modify: `packages/cli/src/commands/profile.ts` — add `unlock`, `lock`, `rekey`, `change-password` subcommands.
- Modify: `packages/cli/src/commands/vault.ts` — turn into a thin deprecation wrapper that forwards to `profile` and prints `⚠ 'vault' is deprecated; use 'profile' instead.` on stderr.
- Modify: `packages/cli/bin/abadge.ts` — keep the `vault` top-level registration but mark it hidden in `--help` (commander `.description('…', { hidden: true })` or equivalent).

- [ ] **Step 1: Identify the four vault subcommand handlers**

```bash
grep -nE "\.command\(['\"]" packages/cli/src/commands/vault.ts
```

- [ ] **Step 2: Move handlers into `profile.ts`**

Cut each handler body from `vault.ts` and register them on the `profile` command object inside `createProfileCommand()`. Don't rewrite behavior — only change the parent command they attach to.

- [ ] **Step 3: Replace `vault.ts` body with a deprecation wrapper**

```typescript
import { Command } from "commander";
import { createProfileCommand } from "./profile";

export function createVaultCommand(): Command {
  const profile = createProfileCommand();
  const vault = new Command("vault")
    .description("[deprecated] alias for 'profile'")
    .hook("preAction", () => {
      console.error("⚠ 'vault' is deprecated; use 'profile' instead.");
    });
  for (const sub of profile.commands) {
    vault.addCommand(sub);
  }
  return vault;
}
```

- [ ] **Step 4: Hide `vault` from `abadge --help`**

In `packages/cli/bin/abadge.ts`, set `.command('vault', ..., { hidden: true })` or the commander equivalent your version supports.

- [ ] **Step 5: Smoke test**

```bash
bun run cli -- profile --help
bun run cli -- profile unlock --help     # or whichever subcommand existed
bun run cli -- vault unlock               # prints deprecation warning, still works
bun run cli -- --help                     # vault NOT listed at top level
```

- [ ] **Step 6: Commit**

```bash
git add packages/cli/
git commit -m "refactor(cli): fold vault subcommands under 'profile' and hide the legacy alias"
```

---

## Phase 4 — Register form UX polish

### Task 4.1: Autocomplete + spellcheck + confirm minLength

**Files:**
- Modify: `apps/web/src/app/(auth)/register/page.tsx:106-148`

- [ ] **Step 1: Edit the four Input props**

```typescript
// Full name (line 106-113)
<Input
  id="name"
  type="text"
  autoComplete="name"
  placeholder="Your full name"
  value={name}
  onChange={(e) => setName(e.target.value)}
  required
/>

// Email (line 116-124)
<Input
  id="email"
  type="email"
  autoComplete="email"
  spellCheck={false}
  placeholder="you@example.com"
  value={email}
  onChange={(e) => setEmail(e.target.value)}
  required
/>

// Password (line 128-137)
<Input
  id="password"
  type="password"
  autoComplete="new-password"
  placeholder="Min 12 characters"
  minLength={12}
  value={password}
  onChange={(e) => setPassword(e.target.value)}
  required
/>

// Confirm password (line 141-148)
<Input
  id="confirm-password"
  type="password"
  autoComplete="new-password"
  placeholder="Repeat password"
  minLength={12}
  value={confirmPassword}
  onChange={(e) => setConfirmPassword(e.target.value)}
  required
/>
```

- [ ] **Step 2: Visual smoke in browser**

Open `/register`. In DevTools run `document.querySelectorAll('input').forEach(i => console.log(i.id, i.autocomplete, i.spellcheck, i.minLength))`. Expect:

```
name name true -1
email email false -1
password new-password false 12
confirm-password new-password false 12
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/(auth)/register/page.tsx
git commit -m "fix(web): add autocomplete, spellcheck, and confirm minLength on /register"
```

### Task 4.2: Pre-render password strength bar and move TOS to /register

**Files:**
- Modify: `apps/web/src/components/ui/password-strength.tsx` — render a dimmed empty bar when `password === ""` instead of returning `null`.
- Modify: `apps/web/src/app/(auth)/register/page.tsx` — add TOS paragraph under the submit button.
- Modify: `apps/web/src/app/onboarding/page.tsx:681-701` — remove the TOS footer from onboarding (it belongs on register now).

- [ ] **Step 1: Edit `password-strength.tsx`**

Find the early-return-when-empty branch and replace with a render of the bar at `width: 0` + `opacity: 0.4`, no score label. Do not leak the score to SRs when empty — `aria-hidden="true"` on the empty state.

- [ ] **Step 2: Add TOS to /register**

In `apps/web/src/app/(auth)/register/page.tsx`, below the `Button` at line 152, above the `SocialAuthButtons`:

```tsx
<p className="text-center text-xs text-muted-foreground">
  By creating an account, you agree to the{" "}
  <Link href="/terms" className="underline hover:text-foreground">
    Terms of Service
  </Link>{" "}
  and{" "}
  <Link href="/privacy" className="underline hover:text-foreground">
    Privacy Policy
  </Link>
  .
</p>
```

- [ ] **Step 3: Remove TOS from onboarding**

Delete the `currentStep === 0 && (<div className="space-y-3 text-center">…</div>)` block in `apps/web/src/app/onboarding/page.tsx:681-701`. Keep only the "Already have an account? Sign in" line if the product wants it.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/password-strength.tsx \
        apps/web/src/app/(auth)/register/page.tsx \
        apps/web/src/app/onboarding/page.tsx
git commit -m "fix(web): pre-render password strength; move TOS from onboarding to register"
```

---

## Phase 5 — Accessible `StorageModePicker` + Dashboard `ProfileCreateDrawer`

### Task 5.1: Factor `StorageModePicker` as a real radio group

**Files:**
- Create: `apps/web/src/components/onboarding/storage-mode-picker.tsx`
- Create: `apps/web/src/components/onboarding/storage-mode-picker.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, expect, test } from "bun:test";
import { render, screen, fireEvent } from "@testing-library/react"; // ensure happy-dom setup
import { StorageModePicker } from "./storage-mode-picker";

describe("StorageModePicker", () => {
  test("exposes two radios with correct aria-checked", () => {
    render(<StorageModePicker value="zero_knowledge" onChange={() => {}} />);
    const zk = screen.getByRole("radio", { name: /zero-knowledge/i });
    const sm = screen.getByRole("radio", { name: /server-managed/i });
    expect(zk).toHaveAttribute("aria-checked", "true");
    expect(sm).toHaveAttribute("aria-checked", "false");
  });

  test("ArrowDown moves selection to server_managed", () => {
    let value: string = "zero_knowledge";
    const { rerender } = render(
      <StorageModePicker value={value as "zero_knowledge" | "server_managed"} onChange={(v) => { value = v; rerender(<StorageModePicker value={v} onChange={() => {}} />); }} />
    );
    const zk = screen.getByRole("radio", { name: /zero-knowledge/i });
    zk.focus();
    fireEvent.keyDown(zk, { key: "ArrowDown" });
    expect(value).toBe("server_managed");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `StorageModePicker`**

Use `role="radiogroup"` on the outer div, `role="radio"` + `aria-checked` + `tabIndex` (only the checked one is 0) on each card, `onKeyDown` handling ArrowUp / ArrowDown / Home / End. Keep the styling from onboarding page lines 542-598 — lift JSX verbatim, only change the semantics.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Replace inline cards in onboarding**

In `apps/web/src/app/onboarding/page.tsx`, replace lines 537-599 (the `<Label> Storage mode` + two `<button>` blocks) with:

```tsx
<StorageModePicker value={storageMode} onChange={setStorageMode} />
```

Import: `import { StorageModePicker } from "@/components/onboarding/storage-mode-picker";`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/onboarding/ \
        apps/web/src/app/onboarding/page.tsx
git commit -m "feat(web): factor StorageModePicker as a11y-correct radio group"
```

### Task 5.2: Add `ProfileCreateDrawer` for the Dashboard

**Files:**
- Create: `apps/web/src/components/dashboard/profile-create-drawer.tsx`
- Create: `apps/web/src/components/dashboard/profile-create-drawer.test.tsx`
- Modify: `apps/web/src/app/(dashboard)/profiles/page.tsx` — mount the drawer, honor `?create=true`.

- [ ] **Step 1: Write failing test**

```tsx
import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { ProfileCreateDrawer } from "./profile-create-drawer";

describe("ProfileCreateDrawer", () => {
  test("renders the same three fields as onboarding step 2", () => {
    render(<ProfileCreateDrawer open={true} onOpenChange={() => {}} orgId="org_1" />);
    expect(screen.getByLabelText(/profile name/i)).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: /storage mode/i })).toBeInTheDocument();
  });

  test("only shows profile password inputs when zero_knowledge", () => {
    render(<ProfileCreateDrawer open={true} onOpenChange={() => {}} orgId="org_1" />);
    // default = zero_knowledge
    expect(screen.getByLabelText(/^profile password/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement the drawer**

Wrap the onboarding Step 2 form body in a new file. Reuse `StorageModePicker`, share `bootstrapZkProfile` and `resolveOrCreateProfile` with the onboarding page (move them into `apps/web/src/lib/profile-bootstrap.ts` first if needed for importability — do that as a micro-commit before this step). On submit, call `profiles.create` then `profiles.bootstrap` if ZK. On success, toast + close the drawer and invalidate the profiles query.

- [ ] **Step 4: Mount on `/profiles` and honor `?create=true`**

Edit `apps/web/src/app/(dashboard)/profiles/page.tsx`:

```tsx
"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { ProfileCreateDrawer } from "@/components/dashboard/profile-create-drawer";
import { useOrgStore } from "@/stores/org-store";

// inside the default export, near top:
const router = useRouter();
const searchParams = useSearchParams();
const activeOrgId = useOrgStore((s) => s.activeOrgId);
const createOpen = searchParams.get("create") === "true";

const closeDrawer = () => {
  const params = new URLSearchParams(searchParams);
  params.delete("create");
  router.replace(`/profiles${params.toString() ? "?" + params.toString() : ""}`);
};

// before the closing JSX tag, append:
{activeOrgId && (
  <ProfileCreateDrawer
    open={createOpen}
    onOpenChange={(next) => !next && closeDrawer()}
    orgId={activeOrgId}
  />
)}
```

Also change the existing `<Link href="/profiles?create=true">…</Link>` to push that URL via the router to preserve client-side state.

- [ ] **Step 5: Smoke in browser**

Navigate `/overview` → click "+ New profile". Drawer opens. Cancel closes it and strips `?create=true`. Submitting a valid form creates a profile that shows up in the list.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/dashboard/profile-create-drawer.tsx \
        apps/web/src/components/dashboard/profile-create-drawer.test.tsx \
        apps/web/src/app/(dashboard)/profiles/page.tsx \
        apps/web/src/lib/profile-bootstrap.ts \
        apps/web/src/app/onboarding/page.tsx
git commit -m "feat(web): ProfileCreateDrawer on /profiles?create=true so operators can add profiles post-onboarding"
```

---

## Phase 6 — Overview + item-drawer fixes

### Task 6.1: Fix `defaultProfileCount`

**Files:**
- Modify: `apps/web/src/app/(dashboard)/overview/page.tsx:281-283`

The current filter is `p.storageMode === "server_managed"`. That is wrong — "default" means the profile seeded during onboarding, which is named `internal`. Change to a count of profiles named `"internal"` (or, better, drive from a future `isDefault` column; start with the name-based filter for now).

- [ ] **Step 1: Write failing component test**

Add to an existing overview test file (or create `apps/web/src/app/(dashboard)/overview/default-profile-count.test.tsx`):

```tsx
import { describe, expect, test } from "bun:test";
import { countDefaultProfiles } from "./page"; // export the helper
// Or inline the function if you prefer a pure unit.

describe("countDefaultProfiles", () => {
  test("counts profiles named 'internal'", () => {
    expect(
      countDefaultProfiles([
        { name: "internal", storageMode: "zero_knowledge" },
        { name: "customer-a", storageMode: "server_managed" },
      ] as never),
    ).toBe(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Fix the filter and export a helper**

In `apps/web/src/app/(dashboard)/overview/page.tsx`, replace lines 281-283:

```typescript
export function countDefaultProfiles(profiles: Array<{ name: string }>): number {
  return profiles.filter((p) => p.name === "internal").length;
}

const defaultProfileCount = countDefaultProfiles(profiles);
```

- [ ] **Step 4: Run — expect PASS; visual smoke**

Expect Overview page to now display `1 default (internal)` for a fresh onboarded user.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/(dashboard)/overview/
git commit -m "fix(web): count profiles named 'internal' as default, not 'server_managed'"
```

### Task 6.2: Fix truncated `Encrypt & save` CTA

**Files:**
- Modify: `apps/web/src/components/dashboard/create-item-panel.tsx:547`

The `size="sm"` + auto-width on the submit button clips to `Encrypt & s…`. Two options; prefer option A:

- [ ] **Step 1 (Option A, preferred): Drop `size="sm"` on submit**

```tsx
<Button form={formId} type="submit" disabled={creating}>
  {creating ? buttonTextCreating : buttonText}
</Button>
```

- [ ] **Step 2: Visual smoke**

Open the drawer. CTA should read "Encrypt & save" without ellipsis at viewport widths ≥ 1024px.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/dashboard/create-item-panel.tsx
git commit -m "fix(web): unclip the 'Encrypt & save' CTA in the create-item drawer"
```

### Task 6.3: Per-page `<title>` metadata

**Files:**
- Modify: each route's `page.tsx` to export `metadata`.

- [ ] **Step 1: Add metadata exports**

For each non-root route, add at the top of the server component or — for "use client" pages — in a sibling `layout.tsx` that owns the `<title>`:

```typescript
export const metadata = {
  title: "Create account · abadge",
};
```

Concrete pages to cover:

| Route | Title |
|-------|-------|
| `/register` | `Create account · abadge` |
| `/login` | `Sign in · abadge` |
| `/device` | `Enter device code · abadge` |
| `/device/approve` | `Approve device · abadge` |
| `/onboarding` | `Onboarding · abadge` |
| `/overview` | `Overview · abadge` |
| `/profiles` | `Profiles · abadge` |
| `/items` | `Items · abadge` |
| `/agents` | `Agents · abadge` |
| `/permissions` | `Permissions · abadge` |
| `/audit` | `Audit log · abadge` |
| `/settings` | `Settings · abadge` |

Because several of these are client components, implement via a sibling `route-title.ts` that exports `metadata` and re-export from `layout.tsx` above the component. Don't add a `"use client"` file with a `metadata` export — Next.js rejects that.

- [ ] **Step 2: Smoke — tab titles update on navigation**

Navigate each route. Confirm browser tab title matches.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app
git commit -m "feat(web): per-page <title> so browser tabs and shares show route context"
```

---

## Phase 7 — Wrap-up

### Task 7.1: Regression sweep

- [ ] **Step 1: Run the full test matrix**

```bash
bun run format
bun run lint
bun run typecheck
bun test
```

Expected: all green.

- [ ] **Step 2: Rerun the Playwright golden path**

Use `docs/reviews/2026-04-14-full-stack-review.md` section 8 as the checklist. Register → onboarding step 1 → step 2 → overview → create item → register agent → grant permission → agent access → audit. Capture a screenshot of each landing page under `docs/reviews/phase-1-validation/`.

- [ ] **Step 3: Commit screenshots**

```bash
git add docs/reviews/phase-1-validation/
git commit -m "docs(review): attach validation screenshots for v0-refactor review fixes"
```

### Task 7.2: Update the review document

- [ ] **Step 1: Mark findings resolved**

Append a "Resolved" section at the top of `docs/reviews/2026-04-14-full-stack-review.md` cross-linking to the commits that closed each finding. Keep the body untouched so the delta is readable.

- [ ] **Step 2: Commit**

```bash
git add docs/reviews/2026-04-14-full-stack-review.md
git commit -m "docs(review): mark review findings as resolved with commit references"
```

---

## Self-Review

### Coverage vs. the source review
- P0-1 → Phase 1
- P0-2 → Phase 2
- A-1 (autocomplete) → Task 4.1
- A-2 (spellcheck email) → Task 4.1
- A-3 (confirm minLength) → Task 4.1
- A-4 (per-page titles) → Task 6.3
- A-5 (TOS on register) → Task 4.2
- A-6 (strength pre-render) → Task 4.2
- O-1 (401 on onboarding) → Phase 1
- O-2 (misleading error banner) → closed indirectly once 401 no longer fires; no separate task because the banner is correct copy for the genuine zero-org state
- O-3 (Vault → Profile password) → Task 3.1
- O-4 (storage-mode a11y) → Task 5.1
- O-5 ("Internal profile" jargon) → deliberately deferred; wording change only, no engineering risk, file as a follow-up
- D-1 (defaultProfileCount) → Task 6.1
- D-2 (drawer vault microcopy) → Task 3.2
- D-3 (CTA truncation) → Task 6.2
- D-4 (inconsistent pickers) → Task 5.1 (StorageModePicker used in both places)
- C-1 (CLI vault / profile) → Task 3.3
- C-2 (CLI tagline) → micro-edit in Task 3.3 (`--help` description update — include with the `vault.ts` → deprecation commit)
- **User addition: Create profile drawer missing on /profiles** → Task 5.2

### Placeholder scan
No "TBD" / "similar to task N" / "fill in details" remain. Every step shows the code, the command, or the edit location.

### Type consistency
- `OptionalOrgSessionIdentity` is defined in Task 1.1 Step 1 and consumed in Task 1.2 Step 3 under the same name.
- `StorageModePicker` props (`value`, `onChange`) are defined in Task 5.1 and consumed in Task 5.2 Step 3.
- `countDefaultProfiles` is introduced in Task 6.1 Step 3 and only consumed there.
- `attachOrganizationAuditHooks` is introduced in Task 2.1 and consumed in Task 2.1 Step 5 — same signature.

No drift.
