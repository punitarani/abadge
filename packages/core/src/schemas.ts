import { z } from "zod";
import {
  AUDIT_EVENT_TYPES,
  AUDIT_RESULTS,
  CAPABILITIES,
  ITEM_KINDS,
  PRINCIPAL_KINDS,
} from "./constants";

// --- Vault ---

const KdfParamsSchema = z.object({
  algorithm: z.literal("argon2id"),
  memory: z.number().int().positive(),
  iterations: z.number().int().positive(),
  parallelism: z.number().int().positive(),
  hashLength: z.number().int().positive(),
});

export const VaultBootstrapSchema = z.object({
  wrappedRootKey: z.string().min(1),
  kdfSalt: z.string().min(1),
  kdfParams: KdfParamsSchema,
});

export const ChangePasswordSchema = z.object({
  wrappedRootKey: z.string().min(1),
  kdfSalt: z.string().min(1),
  kdfParams: KdfParamsSchema,
});

export const RecoverySetupSchema = z.object({
  recoveryWrappedRootKey: z.string().min(1),
});

export const RotateKeySchema = z.object({
  wrappedRootKey: z.string().min(1),
  recoveryWrappedRootKey: z.string().optional(),
  /** Map of item ID to new encrypted_item_key (re-wrapped DEKs) */
  rekeyedItems: z.record(z.string(), z.string().min(1)),
});

// --- Items ---

export const CreateItemSchema = z.discriminatedUnion("storageMode", [
  z.object({
    storageMode: z.literal("zero_knowledge"),
    encryptedItemKey: z.string().min(1),
    ciphertext: z.string().min(1),
  }),
  z.object({
    storageMode: z.literal("server_managed"),
    /** Plaintext payload — server will encrypt */
    payload: z.object({
      v: z.number().int(),
      label: z.string().min(1),
      kind: z.enum(ITEM_KINDS),
      tags: z.array(z.string()).default([]),
      notes: z.string().optional(),
      fields: z.record(z.string(), z.unknown()),
    }),
  }),
]);

export const UpdateItemSchema = z.discriminatedUnion("storageMode", [
  z.object({
    storageMode: z.literal("zero_knowledge"),
    encryptedItemKey: z.string().min(1),
    ciphertext: z.string().min(1),
    contentVersion: z.number().int().positive(),
  }),
  z.object({
    storageMode: z.literal("server_managed"),
    payload: z.object({
      v: z.number().int(),
      label: z.string().min(1),
      kind: z.enum(ITEM_KINDS),
      tags: z.array(z.string()).default([]),
      notes: z.string().optional(),
      fields: z.record(z.string(), z.unknown()),
    }),
    contentVersion: z.number().int().positive(),
  }),
]);

// --- Principals ---

export const CreatePrincipalSchema = z.object({
  kind: z.enum(PRINCIPAL_KINDS),
  name: z.string().min(1).max(255),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

// --- Grants ---

export const CreateGrantSchema = z.object({
  principalId: z.string().min(1),
  itemId: z.string().min(1),
  capability: z.enum(CAPABILITIES),
  expiresAt: z.string().datetime().optional(),
});

// --- Access ---

export const CiphertextAccessSchema = z.object({
  itemId: z.string().min(1),
});

export const RevealAccessSchema = z.object({
  itemId: z.string().min(1),
});

export const MountAccessSchema = z.object({
  itemId: z.string().min(1),
  mountType: z.enum(["env", "file"]),
});

// --- Audit ---

export const AuditQuerySchema = z.object({
  eventType: z.enum(AUDIT_EVENT_TYPES).optional(),
  result: z.enum(AUDIT_RESULTS).optional(),
  principalId: z.string().optional(),
  itemId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
