import { PERSONAL_ORG_METADATA } from "@abadge/core";
import type { Database, Transaction } from "@abadge/db";
import { member, organization, profiles } from "@abadge/db/schema";
import { safeAuditInsert } from "./audit-hooks";

export interface SeedOrgInput {
  userId: string;
  name: string;
  slug: string;
  logo?: string | null;
  /** JSON string for `organization.metadata` (e.g. PERSONAL_ORG_METADATA). */
  metadata?: string | null;
  profileName: string;
  profileExternalId?: string | null;
}

export interface SeedOrgResult {
  /** The inserted organization row, so callers can serialize it through one
   * path (e.g. tRPC `serializeOrg`) instead of rebuilding the shape inline. */
  org: typeof organization.$inferSelect;
  memberId: string;
  profileId: string;
}

/**
 * Inserts an org + its owner `member` + a default `server_managed` profile.
 *
 * The caller owns the transaction boundary (pass a `tx`) so it can decide how
 * to translate unique-violations (e.g. slug collisions). Always seeds a
 * server_managed profile — ZK profiles need client-supplied KDF material that
 * a server-only helper cannot produce. Shared by `createPersonalOrgForUser`
 * and the `organizations.createPersonal` tRPC procedure.
 */
export async function seedOrgWithOwnerProfile(
  tx: Transaction,
  input: SeedOrgInput,
): Promise<SeedOrgResult> {
  const memberId = crypto.randomUUID();
  const profileId = crypto.randomUUID();
  const createdAt = new Date();

  const org: typeof organization.$inferSelect = {
    id: crypto.randomUUID(),
    name: input.name,
    slug: input.slug,
    logo: input.logo ?? null,
    metadata: input.metadata ?? null,
    createdAt,
  };
  await tx.insert(organization).values(org);

  await tx.insert(member).values({
    id: memberId,
    organizationId: org.id,
    userId: input.userId,
    role: "owner",
    createdAt,
  });

  await tx.insert(profiles).values({
    id: profileId,
    organizationId: org.id,
    name: input.profileName,
    externalId: input.profileExternalId ?? null,
    storageMode: "server_managed",
    keyVersion: 1,
    createdAt,
    updatedAt: createdAt,
  });

  return { org, memberId, profileId };
}

/**
 * Creates a personal org + default `server_managed` profile for a user.
 *
 * Explicit seeding helper. Signup does NOT auto-invoke this — users create or
 * join their first organization (or pick "Personal") through the /onboarding
 * flow (see apps/web/src/app/onboarding/page.tsx; the user-facing personal
 * path is `organizations.createPersonal`). Retained for:
 * - tests that need a seeded org without driving the UI
 * - potential admin / migration scripts
 *
 * The seeded org is flagged personal via `organization.metadata` and its
 * profile matches the user-facing flow (`name`/`externalId` both `"default"`).
 * The caller owns error handling; this function throws on DB failure.
 */
export async function createPersonalOrgForUser(
  db: Database,
  user: { id: string; email?: string | null; name?: string | null },
): Promise<void> {
  const slugBase = (user.email?.split("@")[0] ?? "user")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);
  const slug = `${slugBase || "user"}-${crypto.randomUUID().slice(0, 6)}`;
  const name = user.name ? `${user.name}'s workspace` : "Personal workspace";

  const { org } = await db.transaction((tx) =>
    seedOrgWithOwnerProfile(tx, {
      userId: user.id,
      name,
      slug,
      metadata: PERSONAL_ORG_METADATA,
      profileName: "default",
      profileExternalId: "default",
    }),
  );

  await safeAuditInsert(db, {
    organizationId: org.id,
    userId: user.id,
    eventType: "org.create",
    result: "allowed",
    ipAddress: null,
    surface: "auth",
    meta: { auto: true, trigger: "createPersonalOrgForUser", slug },
  });
}
