import { Schema } from "effect";
import {
  AGENT_KINDS,
  AUDIT_EVENT_TYPES,
  AUDIT_RESULTS,
  CAPABILITIES,
  ITEM_KINDS,
  STORAGE_MODES,
} from "./constants";

const NonEmptyString = Schema.String.pipe(Schema.minLength(1));
const BoundedNameString = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(255));
const IsoDateString = Schema.String;
const JsonRecord = Schema.Record({ key: Schema.String, value: Schema.Unknown });
const NullableIsoDateString = Schema.NullOr(IsoDateString);

export const StorageModeSchema = Schema.Literal(...STORAGE_MODES);
export const ItemKindSchema = Schema.Literal(...ITEM_KINDS);
export const AgentKindSchema = Schema.Literal(...AGENT_KINDS);
export const CapabilitySchema = Schema.Literal(...CAPABILITIES);
export const AuditEventTypeSchema = Schema.Literal(...AUDIT_EVENT_TYPES);
export const AuditResultSchema = Schema.Literal(...AUDIT_RESULTS);

export const KdfParamsSchema = Schema.Struct({
  algorithm: Schema.Literal("argon2id"),
  memory: Schema.Int.pipe(Schema.positive()),
  iterations: Schema.Int.pipe(Schema.positive()),
  parallelism: Schema.Int.pipe(Schema.positive()),
  hashLength: Schema.Int.pipe(Schema.positive()),
});

export const ItemPayloadSchema = Schema.Struct({
  v: Schema.Int,
  label: NonEmptyString,
  kind: ItemKindSchema,
  tags: Schema.Array(Schema.String),
  notes: Schema.optional(Schema.String),
  fields: JsonRecord,
});

export const VaultBootstrapSchema = Schema.Struct({
  wrappedRootKey: NonEmptyString,
  kdfSalt: NonEmptyString,
  kdfParams: KdfParamsSchema,
});

export const ChangePasswordSchema = Schema.Struct({
  wrappedRootKey: NonEmptyString,
  kdfSalt: NonEmptyString,
  kdfParams: KdfParamsSchema,
});

export const RecoverySetupSchema = Schema.Struct({
  recoveryWrappedRootKey: NonEmptyString,
});

export const RotateKeySchema = Schema.Struct({
  wrappedRootKey: NonEmptyString,
  recoveryWrappedRootKey: Schema.optional(Schema.String),
  rekeyedItems: Schema.Record({ key: Schema.String, value: NonEmptyString }),
});

export const ZeroKnowledgeCreateItemSchema = Schema.Struct({
  storageMode: Schema.Literal("zero_knowledge"),
  encryptedItemKey: NonEmptyString,
  ciphertext: NonEmptyString,
});

export const ServerManagedCreateItemSchema = Schema.Struct({
  storageMode: Schema.Literal("server_managed"),
  payload: ItemPayloadSchema,
});

export const CreateItemSchema = Schema.Union(
  ZeroKnowledgeCreateItemSchema,
  ServerManagedCreateItemSchema,
);

export const ZeroKnowledgeUpdateItemSchema = Schema.Struct({
  storageMode: Schema.Literal("zero_knowledge"),
  encryptedItemKey: NonEmptyString,
  ciphertext: NonEmptyString,
  contentVersion: Schema.Int.pipe(Schema.positive()),
});

export const ServerManagedUpdateItemSchema = Schema.Struct({
  storageMode: Schema.Literal("server_managed"),
  payload: ItemPayloadSchema,
  contentVersion: Schema.Int.pipe(Schema.positive()),
});

export const UpdateItemSchema = Schema.Union(
  ZeroKnowledgeUpdateItemSchema,
  ServerManagedUpdateItemSchema,
);

export const CreateAgentSchema = Schema.Struct({
  kind: AgentKindSchema,
  name: BoundedNameString,
  metadata: Schema.optional(JsonRecord),
});

export const CreatePermissionSchema = Schema.Struct({
  agentId: NonEmptyString,
  itemId: NonEmptyString,
  capability: CapabilitySchema,
  expiresAt: Schema.optional(IsoDateString),
});

export const CiphertextAccessSchema = Schema.Struct({
  itemId: NonEmptyString,
});

export const RevealAccessSchema = Schema.Struct({
  itemId: NonEmptyString,
});

export const MountAccessSchema = Schema.Struct({
  itemId: NonEmptyString,
  mountType: Schema.Literal("env", "file"),
});

export const AuditQuerySchema = Schema.Struct({
  eventType: Schema.optional(AuditEventTypeSchema),
  result: Schema.optional(AuditResultSchema),
  agentId: Schema.optional(Schema.String),
  itemId: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(
    Schema.Int.pipe(Schema.greaterThanOrEqualTo(1), Schema.lessThanOrEqualTo(100)),
  ),
});

export const VaultSchema = Schema.Struct({
  id: NonEmptyString,
  userId: NonEmptyString,
  wrappedRootKey: NonEmptyString,
  kdfSalt: NonEmptyString,
  kdfParams: KdfParamsSchema,
  recoveryWrappedRootKey: Schema.NullOr(Schema.String),
  keyVersion: Schema.Int.pipe(Schema.positive()),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});

export const ItemSummarySchema = Schema.Struct({
  id: NonEmptyString,
  storageMode: StorageModeSchema,
  cryptoVersion: Schema.Int,
  contentVersion: Schema.Int,
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});

const ItemDetailBaseFields = {
  id: NonEmptyString,
  storageMode: StorageModeSchema,
  cryptoVersion: Schema.Int,
  contentVersion: Schema.Int,
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
} as const;

export const ZeroKnowledgeItemDetailSchema = Schema.Struct({
  ...ItemDetailBaseFields,
  storageMode: Schema.Literal("zero_knowledge"),
  encryptedItemKey: NonEmptyString,
  ciphertext: NonEmptyString,
});

export const ServerManagedItemDetailSchema = Schema.Struct({
  ...ItemDetailBaseFields,
  storageMode: Schema.Literal("server_managed"),
});

export const ItemDetailSchema = Schema.Union(
  ZeroKnowledgeItemDetailSchema,
  ServerManagedItemDetailSchema,
);

export const AgentSchema = Schema.Struct({
  id: NonEmptyString,
  userId: NonEmptyString,
  kind: AgentKindSchema,
  locality: Schema.Literal("local", "remote"),
  name: NonEmptyString,
  keyPrefix: Schema.NullOr(Schema.String),
  enabled: Schema.Boolean,
  revokedAt: Schema.NullOr(IsoDateString),
  lastUsedAt: Schema.NullOr(IsoDateString),
  metadata: JsonRecord,
  createdAt: IsoDateString,
});

export const AgentWithKeySchema = Schema.Struct({
  agent: AgentSchema,
  apiKey: NonEmptyString,
});

export const AgentRotateResultSchema = Schema.Struct({
  apiKey: NonEmptyString,
  keyPrefix: NonEmptyString,
});

export const PermissionSchema = Schema.Struct({
  id: NonEmptyString,
  agentId: NonEmptyString,
  itemId: NonEmptyString,
  capability: CapabilitySchema,
  expiresAt: NullableIsoDateString,
  createdBy: NonEmptyString,
  createdAt: IsoDateString,
});

export const AuditEntrySchema = Schema.Struct({
  id: Schema.Int,
  userId: NonEmptyString,
  agentId: Schema.NullOr(Schema.String),
  itemId: Schema.NullOr(Schema.String),
  eventType: AuditEventTypeSchema,
  result: AuditResultSchema,
  deliveryMode: Schema.NullOr(Schema.String),
  meta: JsonRecord,
  ipAddress: Schema.NullOr(Schema.String),
  occurredAt: IsoDateString,
});

export const CiphertextAccessResponseSchema = Schema.Struct({
  encryptedItemKey: NonEmptyString,
  ciphertext: NonEmptyString,
  cryptoVersion: Schema.Int,
});

export const RevealAccessResponseSchema = Schema.Struct({
  payload: ItemPayloadSchema,
});

export const ZeroKnowledgeMountAccessResponseSchema = Schema.Struct({
  storageMode: Schema.Literal("zero_knowledge"),
  encryptedItemKey: NonEmptyString,
  ciphertext: NonEmptyString,
  cryptoVersion: Schema.Int,
});

export const ServerManagedMountAccessResponseSchema = Schema.Struct({
  storageMode: Schema.Literal("server_managed"),
  payload: ItemPayloadSchema,
});

export const MountAccessResponseSchema = Schema.Union(
  ZeroKnowledgeMountAccessResponseSchema,
  ServerManagedMountAccessResponseSchema,
);

export const IdResultSchema = Schema.Struct({
  id: NonEmptyString,
});

export const SuccessResultSchema = Schema.Struct({
  ok: Schema.Boolean,
});

export const KeyVersionResultSchema = Schema.Struct({
  ok: Schema.Boolean,
  keyVersion: Schema.Int.pipe(Schema.positive()),
});

export const ItemVersionResultSchema = Schema.Struct({
  ok: Schema.Boolean,
  contentVersion: Schema.Int.pipe(Schema.positive()),
});

export const VaultResultSchema = Schema.Struct({
  vault: VaultSchema,
});

export const ItemResultSchema = Schema.Struct({
  item: ItemDetailSchema,
});

export const ItemListResultSchema = Schema.Struct({
  items: Schema.Array(ItemSummarySchema),
});

export const AgentResultSchema = Schema.Struct({
  agent: AgentSchema,
});

export const AgentListResultSchema = Schema.Struct({
  agents: Schema.Array(AgentSchema),
});

export const PermissionResultSchema = Schema.Struct({
  permission: PermissionSchema,
});

export const PermissionListResultSchema = Schema.Struct({
  permissions: Schema.Array(PermissionSchema),
});

export const AuditListResultSchema = Schema.Struct({
  entries: Schema.Array(AuditEntrySchema),
  nextCursor: Schema.NullOr(Schema.String),
});
