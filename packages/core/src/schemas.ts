import { Schema } from "effect";
import {
  AGENT_KINDS,
  AUDIT_EVENT_TYPES,
  AUDIT_RESULTS,
  CAPABILITIES,
  ITEM_KINDS,
  PRINCIPAL_AUTH_METHODS,
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
export const PrincipalAuthMethodSchema = Schema.Literal(...PRINCIPAL_AUTH_METHODS);
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
  v: Schema.optional(Schema.Int),
  label: Schema.optional(NonEmptyString),
  kind: Schema.optional(ItemKindSchema),
  tags: Schema.optional(Schema.Array(Schema.String)),
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
  label: NonEmptyString,
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
  label: NonEmptyString,
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

const CreateAgentSchemaBase = Schema.Struct({
  kind: AgentKindSchema,
  name: BoundedNameString,
  authMethod: Schema.optional(PrincipalAuthMethodSchema),
  publicKey: Schema.optional(NonEmptyString),
  issueBootstrapToken: Schema.optional(Schema.Boolean),
  metadata: Schema.optional(JsonRecord),
});

export const CreateAgentSchema = CreateAgentSchemaBase.pipe(
  Schema.filter((input) => {
    if (input.authMethod === "legacy_api_key" && input.publicKey) {
      return "Legacy API-key agents cannot set a public key.";
    }

    if (input.authMethod === "legacy_api_key" && input.issueBootstrapToken === true) {
      return "Legacy API-key agents cannot issue bootstrap tokens.";
    }

    return true;
  }),
);

export const IssueAgentBootstrapTokenSchema = Schema.Struct({
  agentId: NonEmptyString,
});

export const EnrollAgentSchema = Schema.Struct({
  bootstrapToken: NonEmptyString,
  publicKey: NonEmptyString,
});

export const CreateAgentChallengeSchema = Schema.Struct({
  agentId: NonEmptyString,
});

export const ExchangeAgentSessionSchema = Schema.Struct({
  agentId: NonEmptyString,
  challengeId: NonEmptyString,
  challenge: NonEmptyString,
  signature: NonEmptyString,
});

export const RevokeAgentSessionSchema = Schema.Struct({
  token: NonEmptyString,
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

export const ProfileSchema = Schema.Struct({
  id: NonEmptyString,
  organizationId: NonEmptyString,
  name: NonEmptyString,
  description: Schema.NullOr(Schema.String),
  storageMode: StorageModeSchema,
  wrappedRootKey: Schema.NullOr(Schema.String),
  kdfSalt: Schema.NullOr(Schema.String),
  kdfParams: Schema.NullOr(KdfParamsSchema),
  recoveryWrappedRootKey: Schema.NullOr(Schema.String),
  keyVersion: Schema.Int.pipe(Schema.positive()),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});

export const ItemSummarySchema = Schema.Struct({
  id: NonEmptyString,
  label: NonEmptyString,
  storageMode: StorageModeSchema,
  cryptoVersion: Schema.Int,
  contentVersion: Schema.Int,
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
});

const ItemDetailBaseFields = {
  id: NonEmptyString,
  label: NonEmptyString,
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
  userId: Schema.optional(NonEmptyString),
  organizationId: Schema.optional(NonEmptyString),
  createdBy: Schema.optional(NonEmptyString),
  kind: AgentKindSchema,
  locality: Schema.Literal("local", "remote"),
  authMethod: PrincipalAuthMethodSchema,
  name: NonEmptyString,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  publicKeyConfigured: Schema.Boolean,
  keyPrefix: Schema.NullOr(Schema.String),
  enabled: Schema.Boolean,
  revokedAt: Schema.NullOr(IsoDateString),
  lastUsedAt: Schema.NullOr(IsoDateString),
  metadata: JsonRecord,
  createdAt: IsoDateString,
});

export const AgentRegistrationResultSchema = Schema.Struct({
  agent: AgentSchema,
  apiKey: Schema.NullOr(Schema.String),
  bootstrapToken: Schema.NullOr(Schema.String),
  bootstrapExpiresAt: Schema.NullOr(IsoDateString),
});

export const AgentWithKeySchema = AgentRegistrationResultSchema;

export const AgentRotateResultSchema = Schema.Struct({
  apiKey: NonEmptyString,
  keyPrefix: NonEmptyString,
});

export const AgentBootstrapTokenResultSchema = Schema.Struct({
  agentId: NonEmptyString,
  bootstrapToken: NonEmptyString,
  expiresAt: IsoDateString,
});

export const AgentEnrollmentResultSchema = Schema.Struct({
  agent: AgentSchema,
  enrolledAt: IsoDateString,
});

export const AgentChallengeResultSchema = Schema.Struct({
  agentId: NonEmptyString,
  challengeId: NonEmptyString,
  challenge: NonEmptyString,
  expiresAt: IsoDateString,
});

export const AgentSessionSchema = Schema.Struct({
  token: NonEmptyString,
  expiresAt: IsoDateString,
});

export const AgentSessionResultSchema = Schema.Struct({
  agentId: NonEmptyString,
  session: AgentSessionSchema,
});

export const CliLocalAgentReferenceSchema = Schema.Struct({
  agentId: NonEmptyString,
  privateKeyPath: NonEmptyString,
});

export const CliProfileConfigSchema = Schema.Struct({
  apiUrl: NonEmptyString,
  operatorUserId: Schema.optional(NonEmptyString),
  profileName: Schema.optional(NonEmptyString),
  localAgents: Schema.optional(
    Schema.Struct({
      cli: Schema.optional(CliLocalAgentReferenceSchema),
      mcp: Schema.optional(CliLocalAgentReferenceSchema),
    }),
  ),
});

export const DaemonOperatorSessionSchema = Schema.Struct({
  authenticated: Schema.Boolean,
  userId: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(IsoDateString),
});

export const PermissionSchema = Schema.Struct({
  id: NonEmptyString,
  organizationId: Schema.optional(NonEmptyString),
  agentId: NonEmptyString,
  itemId: NonEmptyString,
  capability: CapabilitySchema,
  expiresAt: NullableIsoDateString,
  createdBy: NonEmptyString,
  grantedBy: Schema.optional(NonEmptyString),
  createdAt: IsoDateString,
});

export const AuditEntrySchema = Schema.Struct({
  id: Schema.Int,
  organizationId: Schema.optional(NonEmptyString),
  userId: NonEmptyString,
  agentId: Schema.NullOr(Schema.String),
  itemId: Schema.NullOr(Schema.String),
  profileId: Schema.optional(Schema.NullOr(Schema.String)),
  surface: Schema.optional(Schema.NullOr(Schema.String)),
  eventType: AuditEventTypeSchema,
  result: AuditResultSchema,
  field: Schema.optional(Schema.NullOr(Schema.String)),
  purpose: Schema.optional(Schema.NullOr(Schema.String)),
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

export const ProfileResultSchema = Schema.Struct({
  profile: ProfileSchema,
});

export const ProfileListResultSchema = Schema.Struct({
  profiles: Schema.Array(ProfileSchema),
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
