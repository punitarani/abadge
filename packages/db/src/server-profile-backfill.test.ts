import { describe, expect, test } from "bun:test";
import { serverDecrypt, serverEncrypt } from "@abadge/crypto/server";
import {
  profileIdForServerAad,
  SERVER_AAD_MIN_VERSION,
  type ServerAadMeta,
} from "@abadge/crypto/shared";
import {
  type BoundServerItem,
  backfillServerManagedItemProfiles,
  type ServerItemProfileBackfillStore,
} from "./server-profile-backfill";

const KEY = Buffer.from(new Uint8Array(32).fill(7)).toString("base64");
const ORG = "org_1";
const PROFILE = "prf_default";

interface Row {
  id: string;
  organizationId: string;
  profileId: string | null;
  serverCiphertext: string;
  serverIv: string;
  serverKeyVersion: number;
}

function makeStore(
  rows: Row[],
  targetByOrg: Record<string, string | null>,
): ServerItemProfileBackfillStore {
  return {
    async listBootstrappedOrgIds() {
      return [...new Set(rows.map((r) => r.organizationId))];
    },
    async defaultServerManagedProfileId(orgId) {
      return targetByOrg[orgId] ?? null;
    },
    async listUnboundServerManagedItems(orgId) {
      return rows
        .filter((r) => r.organizationId === orgId && r.profileId === null)
        .map((r) => ({
          id: r.id,
          serverCiphertext: r.serverCiphertext,
          serverIv: r.serverIv,
          serverKeyVersion: r.serverKeyVersion,
        }));
    },
    async bindServerManagedItem(bound: BoundServerItem) {
      const row = rows.find((r) => r.id === bound.id);
      if (!row) throw new Error(`unknown item ${bound.id}`);
      row.profileId = bound.profileId;
      row.serverCiphertext = bound.serverCiphertext;
      row.serverIv = bound.serverIv;
      row.serverKeyVersion = bound.serverKeyVersion;
    },
  };
}

async function seedV1(id: string, payload: unknown): Promise<Row> {
  // Legacy v1: no AAD, keyVersion 1.
  const enc = await serverEncrypt(new TextEncoder().encode(JSON.stringify(payload)), KEY, 1);
  return {
    id,
    organizationId: ORG,
    profileId: null,
    serverCiphertext: enc.ciphertext,
    serverIv: enc.iv,
    serverKeyVersion: enc.keyVersion,
  };
}

async function seedV2Null(id: string, payload: unknown): Promise<Row> {
  // Legacy v2 row: AAD with the no-profile sentinel.
  const aad: ServerAadMeta = {
    orgId: ORG,
    profileId: profileIdForServerAad(null),
    itemId: id,
    keyVersion: SERVER_AAD_MIN_VERSION,
  };
  const enc = await serverEncrypt(
    new TextEncoder().encode(JSON.stringify(payload)),
    KEY,
    SERVER_AAD_MIN_VERSION,
    aad,
  );
  return {
    id,
    organizationId: ORG,
    profileId: null,
    serverCiphertext: enc.ciphertext,
    serverIv: enc.iv,
    serverKeyVersion: enc.keyVersion,
  };
}

async function decryptUnderProfile(row: Row): Promise<unknown> {
  const aad: ServerAadMeta = {
    orgId: row.organizationId,
    profileId: profileIdForServerAad(row.profileId),
    itemId: row.id,
    keyVersion: row.serverKeyVersion,
  };
  const plaintext = await serverDecrypt(
    { ciphertext: row.serverCiphertext, iv: row.serverIv, keyVersion: row.serverKeyVersion },
    KEY,
    aad,
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

describe("backfillServerManagedItemProfiles", () => {
  test("binds v1 and v2-null items; each decrypts under the new profile-bound AAD", async () => {
    const v1 = await seedV1("itm_v1", { secret: "alpha" });
    const v2 = await seedV2Null("itm_v2", { secret: "bravo" });
    const rows = [v1, v2];
    const store = makeStore(rows, { [ORG]: PROFILE });

    const result = await backfillServerManagedItemProfiles({ db: store, encryptionKey: KEY });

    expect(result.migrated).toBe(2);
    expect(result.scanned).toBe(2);
    expect(result.perOrg).toEqual([{ organizationId: ORG, profileId: PROFILE, migrated: 2 }]);

    for (const row of rows) {
      expect(row.profileId).toBe(PROFILE);
      expect(row.serverKeyVersion).toBe(SERVER_AAD_MIN_VERSION);
    }
    // The whole point: ciphertext now decrypts under AAD bound to the real
    // profile (and the plaintext survived the re-encryption intact).
    expect(await decryptUnderProfile(rows[0] as Row)).toEqual({ secret: "alpha" });
    expect(await decryptUnderProfile(rows[1] as Row)).toEqual({ secret: "bravo" });
  });

  test("is idempotent — a second run migrates nothing", async () => {
    const rows = [await seedV1("itm_v1", { secret: "alpha" })];
    const store = makeStore(rows, { [ORG]: PROFILE });

    const first = await backfillServerManagedItemProfiles({ db: store, encryptionKey: KEY });
    expect(first.migrated).toBe(1);

    const second = await backfillServerManagedItemProfiles({ db: store, encryptionKey: KEY });
    expect(second.migrated).toBe(0);
    expect(second.scanned).toBe(0);
    expect(second.perOrg).toEqual([]);
  });

  test("leaves items untouched when the org has no target profile", async () => {
    const rows = [await seedV1("itm_v1", { secret: "alpha" })];
    const before = { ...rows[0] };
    const store = makeStore(rows, { [ORG]: null });

    const result = await backfillServerManagedItemProfiles({ db: store, encryptionKey: KEY });

    expect(result.migrated).toBe(0);
    expect(result.perOrg).toEqual([]);
    expect(rows[0]).toEqual(before as Row); // profileId still null, ciphertext unchanged
  });

  test("only touches NULL-profile rows — already-bound items are skipped", async () => {
    const bound = await seedV1("itm_bound", { secret: "kept" });
    bound.profileId = "prf_other"; // pretend it is already bound
    const boundCiphertext = bound.serverCiphertext;
    const store = makeStore([bound], { [ORG]: PROFILE });

    const result = await backfillServerManagedItemProfiles({ db: store, encryptionKey: KEY });

    expect(result.migrated).toBe(0);
    expect(bound.profileId).toBe("prf_other");
    expect(bound.serverCiphertext).toBe(boundCiphertext);
  });
});
