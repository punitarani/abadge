#!/usr/bin/env bun
import "dotenv/config";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { backfillServerManagedItemLabels } from "../src/roadmap-backfill";
import { items } from "../src/schema/items";

const databaseUrl = process.env.DATABASE_URL;
const encryptionKey = process.env.ENCRYPTION_KEY;

if (!databaseUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

if (!encryptionKey) {
  console.error("ENCRYPTION_KEY is not set");
  process.exit(1);
}

const sql = postgres(databaseUrl, {
  max: 1,
  fetch_types: false,
  prepare: false,
});

try {
  const db = drizzle(sql);
  const result = await backfillServerManagedItemLabels({
    encryptionKey,
    db: {
      listServerManagedItems: () =>
        db
          .select({
            id: items.id,
            label: items.label,
            serverCiphertext: items.serverCiphertext,
            serverIv: items.serverIv,
            serverKeyVersion: items.serverKeyVersion,
          })
          .from(items)
          .where(eq(items.storageMode, "server_managed")),
      updateItemLabel: (itemId, label) =>
        db.update(items).set({ label }).where(eq(items.id, itemId)).then(() => undefined),
    },
  });

  console.log(
    `Roadmap backfill complete. Scanned ${result.scanned} server-managed items, updated ${result.updated} labels.`,
  );
} finally {
  await sql.end();
}
