#!/usr/bin/env bun
/**
 * §AB-0003 — re-encrypt NULL-profile server_managed items under their org's
 * default profile and bind them, so profile-level grants cover them.
 *
 * Idempotent: only `profileId IS NULL` rows are touched, so a second run is a
 * no-op. Logs a per-org count. The re-encryption logic lives in the tested pure
 * helper `backfillServerManagedItemProfiles`; this runner is the Drizzle glue.
 *
 *   DATABASE_URL=... ENCRYPTION_KEY=... bun scripts/backfill-server-item-profiles.ts
 */
import process from "node:process";
import {
  and,
  backfillServerManagedItemProfiles,
  createDb,
  eq,
  isNull,
  items,
  profiles,
  type ServerItemProfileBackfillStore,
  sql,
} from "@abadge/db";

const databaseUrl = process.env.DATABASE_URL;
const encryptionKey = process.env.ENCRYPTION_KEY;
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}
if (!encryptionKey) {
  console.error("ENCRYPTION_KEY is required.");
  process.exit(1);
}

const db = createDb(databaseUrl);

const store: ServerItemProfileBackfillStore = {
  async listBootstrappedOrgIds() {
    // Orgs that have a server_managed profile — the only orgs with a binding target.
    const rows = await db
      .selectDistinct({ organizationId: profiles.organizationId })
      .from(profiles)
      .where(eq(profiles.storageMode, "server_managed"));
    return rows.map((row) => row.organizationId);
  },

  async defaultServerManagedProfileId(organizationId) {
    // Mirror items.resolveTargetProfile: prefer externalId='default', else oldest.
    const [row] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(
        and(
          eq(profiles.organizationId, organizationId),
          eq(profiles.storageMode, "server_managed"),
        ),
      )
      .orderBy(
        sql`case when ${profiles.externalId} = 'default' then 0 else 1 end`,
        profiles.createdAt,
      )
      .limit(1);
    return row?.id ?? null;
  },

  async listUnboundServerManagedItems(organizationId) {
    const rows = await db
      .select({
        id: items.id,
        serverCiphertext: items.serverCiphertext,
        serverIv: items.serverIv,
        serverKeyVersion: items.serverKeyVersion,
      })
      .from(items)
      .where(
        and(
          eq(items.organizationId, organizationId),
          eq(items.storageMode, "server_managed"),
          isNull(items.profileId),
          isNull(items.deletedAt),
        ),
      );
    // Server-managed rows always carry these, but the columns are nullable in
    // the schema; drop anything malformed rather than crash the whole run.
    return rows.flatMap((row) =>
      row.serverCiphertext && row.serverIv && row.serverKeyVersion != null
        ? [
            {
              id: row.id,
              serverCiphertext: row.serverCiphertext,
              serverIv: row.serverIv,
              serverKeyVersion: row.serverKeyVersion,
            },
          ]
        : [],
    );
  },

  async bindServerManagedItem(item) {
    await db
      .update(items)
      .set({
        profileId: item.profileId,
        serverCiphertext: item.serverCiphertext,
        serverIv: item.serverIv,
        serverKeyVersion: item.serverKeyVersion,
      })
      .where(eq(items.id, item.id));
  },
};

const result = await backfillServerManagedItemProfiles({ db: store, encryptionKey });

for (const org of result.perOrg) {
  console.log(
    `org ${org.organizationId}: bound ${org.migrated} item(s) to profile ${org.profileId}`,
  );
}
console.log(
  `Backfill complete: ${result.migrated} item(s) bound across ${result.perOrg.length} org(s) (${result.scanned} scanned).`,
);
