import { Schema } from "effect";
import {
  AGENT_AUTH_METHODS,
  AGENT_KINDS,
  AUDIT_EVENT_TYPES,
  AUDIT_RESULTS,
  CAPABILITIES,
  ITEM_KINDS,
  MAX_AGENT_METADATA_DEPTH,
  MAX_AGENT_METADATA_JSON_BYTES,
  STORAGE_MODES,
} from "./constants";

const NonEmptyString = Schema.String.pipe(Schema.minLength(1));

/**
 * §W1S7-001 — Client-provided UUIDs for ZK item create. The itemId is bound
 * into the XChaCha20-Poly1305 AAD at encrypt time, so the client must choose
 * the id before wrapping the payload. The server validates this pattern and
 * maps the insert-time unique-violation to a ConflictError so two clients
 * racing with the same UUID see a domain error rather than a 500.
 */
const UuidString = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
);

// §AGC1b — iterative depth check: avoids stack-overflow on adversarial input.
function jsonDepth(root: unknown): number {
  let maxDepth = 0;
  // [value, depth] pairs
  const stack: Array<[unknown, number]> = [[root, 0]];
  while (stack.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: stack.length > 0 checked above
    const [value, depth] = stack.pop()!;
    if (depth > maxDepth) maxDepth = depth;
    // Short-circuit: no need to go deeper once we exceeded the limit.
    if (maxDepth > MAX_AGENT_METADATA_DEPTH) return maxDepth;
    if (typeof value === "object" && value !== null) {
      const children = Array.isArray(value) ? value : Object.values(value);
      for (const child of children) {
        stack.push([child, depth + 1]);
      }
    }
  }
  return maxDepth;
}

// §AGC1d — Reject names that are pure whitespace or contain zero-width /
// bidi-control characters commonly used to disguise identifiers.
// Keep maxLength at 255 to preserve existing data compatibility.
const BoundedNameString = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(255),
  Schema.filter((s) => {
    if (s.trim().length === 0) return "name cannot be empty or whitespace-only";
    // Reject: U+200B–U+200F (zero-width + LRM/RLM), U+202A–U+202E (bidi embeds/overrides),
    // U+2066–U+2069 (bidi isolates), U+FEFF (ZWNBSP/BOM), U+180E (Mongolian vowel separator).
    if (/[​-‏‪-‮⁦-⁩﻿᠎]/.test(s)) {
      return "name contains zero-width or bidi-control characters";
    }
    return true;
  }),
);

// §AGC1e — publicKey must be a JSON-serialised JWK with kty:"OKP" and crv:"Ed25519".
// The codebase stores the result of JSON.stringify(crypto.subtle.exportKey("jwk", ...))
// which produces ~111-char strings like {"crv":"Ed25519","ext":true,"key_ops":["verify"],"kty":"OKP","x":"..."}.
// We validate structure rather than a raw base64url pattern.
const AgentPublicKeyString = Schema.String.pipe(
  Schema.minLength(50), // JWK with Ed25519 x-value is at least ~80 chars; 50 gives room
  Schema.maxLength(1024), // generous upper bound; real JWKs are ~111 chars
  Schema.filter((s) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(s);
    } catch {
      return 'publicKey must be a JSON-serialised JWK (e.g. from crypto.subtle.exportKey("jwk", ...))';
    }
    const jwk = parsed as Record<string, unknown>;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      jwk.kty !== "OKP" ||
      jwk.crv !== "Ed25519" ||
      typeof jwk.x !== "string" ||
      (jwk.x as string).length < 40
    ) {
      return 'publicKey JWK must have kty:"OKP", crv:"Ed25519", and a valid x field';
    }
    return true;
  }),
);
const IsoDateString = Schema.String;
const JsonRecord = Schema.Record({ key: Schema.String, value: Schema.Unknown });
const NullableIsoDateString = Schema.NullOr(IsoDateString);

export const StorageModeSchema = Schema.Literal(...STORAGE_MODES);
export const ItemKindSchema = Schema.Literal(...ITEM_KINDS);
export const AgentKindSchema = Schema.Literal(...AGENT_KINDS);
export const AgentAuthMethodSchema = Schema.Literal(...AGENT_AUTH_METHODS);
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

export const RekeyedItemSchema = Schema.Struct({
  itemId: NonEmptyString,
  encryptedItemKey: NonEmptyString,
});

export const RotateKeySchema = Schema.Struct({
  wrappedRootKey: NonEmptyString,
  recoveryWrappedRootKey: Schema.optional(Schema.String),
  rekeyedItems: Schema.Array(RekeyedItemSchema),
});

export const ZeroKnowledgeCreateItemSchema = Schema.Struct({
  storageMode: Schema.Literal("zero_knowledge"),
  // §W1S7-001 — Client-provided id. The id is bound into the XChaCha20-Poly1305
  // AAD at encrypt time (see `buildZkContentAad` / `buildZkDekWrapAad`), so the
  // server MUST use this value verbatim when inserting the row. Any server-side
  // replacement would break the AAD binding and make the item undecryptable.
  id: UuidString,
  label: NonEmptyString,
  encryptedItemKey: NonEmptyString,
  ciphertext: NonEmptyString,
  // Optional CAS: if set, server aborts with CONFLICT when the profile's
  // current keyVersion differs. Guards against a rotate committing between
  // the client's wrap (against keyVersion=N) and the insert landing.
  expectedKeyVersion: Schema.optional(Schema.Int.pipe(Schema.nonNegative())),
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
  authMethod: Schema.optional(AgentAuthMethodSchema),
  publicKey: Schema.optional(AgentPublicKeyString), // §AGC1e — JWK format
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

    // §AGC1c — reject ambiguous combo: public_key_session with BOTH publicKey
    // and issueBootstrapToken set. Callers must specify exactly one.
    const isPublicKeySession =
      input.authMethod === "public_key_session" || input.authMethod === undefined;
    if (isPublicKeySession && input.publicKey && input.issueBootstrapToken === true) {
      return "public_key_session agents: specify either publicKey OR issueBootstrapToken, not both.";
    }

    // §AGC1b — metadata size (UTF-16 code units; TextEncoder is unavailable in
    // Effect Schema filter which runs in both browser and CF Workers). JSON.stringify
    // length is an upper bound on actual UTF-8 bytes because every ASCII char ≤1 byte;
    // multi-byte chars are fewer in code units than bytes only for >U+FFFF, which are
    // rare. The 16 KB cap here is a "good enough" guard — a body-limit middleware
    // (§DoS2) enforces the hard 1 MB ceiling. Depth check runs first to guard against
    // a pathological tree that causes stringify to stack-overflow.
    if (input.metadata !== undefined) {
      const depth = jsonDepth(input.metadata);
      if (depth > MAX_AGENT_METADATA_DEPTH) {
        return `metadata nesting exceeds ${MAX_AGENT_METADATA_DEPTH} levels (got ${depth}).`;
      }
      let serialized: string;
      try {
        serialized = JSON.stringify(input.metadata);
      } catch {
        return "metadata contains circular references or non-serializable values.";
      }
      if (serialized.length > MAX_AGENT_METADATA_JSON_BYTES) {
        return `metadata exceeds ${MAX_AGENT_METADATA_JSON_BYTES} bytes (got ${serialized.length}).`;
      }
    }

    return true;
  }),
);

export const IssueAgentBootstrapTokenSchema = Schema.Struct({
  agentId: NonEmptyString,
});

export const EnrollAgentSchema = Schema.Struct({
  bootstrapToken: NonEmptyString,
  publicKey: AgentPublicKeyString, // §AGC1e — JWK format validation
});

export const CreateAgentChallengeSchema = Schema.Struct({
  agentId: NonEmptyString,
});

// Base64url charset: A–Z a–z 0–9 - _ (no padding). Both fields use unpadded
// base64url (toBase64 strips "="). A valid base64 quantum is at least 4 chars;
// require minLength to block single-char valid-charset inputs that pass the
// pattern but cause atob/fromBase64 to throw SyntaxError → 500 oracle.
const Base64UrlSig = Schema.String.pipe(
  Schema.pattern(/^[A-Za-z0-9_-]+=*$/),
  // Ed25519 sig is 64 bytes → 86 chars unpadded, 88 with padding. Accept both.
  Schema.minLength(86),
  Schema.maxLength(88),
);

const Base64UrlChallenge = Schema.String.pipe(
  Schema.pattern(/^[A-Za-z0-9_-]+=*$/),
  // Challenge is prefix (e.g. "abc_") + base64url(32 random bytes) = ~47 chars.
  // minLength(8) blocks quantum-invalid single-char inputs; maxLength(256) caps DoS.
  Schema.minLength(8),
  Schema.maxLength(256),
);

export const ExchangeAgentSessionSchema = Schema.Struct({
  agentId: NonEmptyString,
  challengeId: NonEmptyString,
  challenge: Base64UrlChallenge,
  signature: Base64UrlSig,
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
  field: Schema.optional(NonEmptyString),
  purpose: Schema.optional(Schema.String),
});

export const MountAccessSchema = Schema.Struct({
  itemId: NonEmptyString,
  mountType: Schema.Literal("env", "file"),
  field: Schema.optional(NonEmptyString),
  purpose: Schema.optional(Schema.String),
});

export const AuditQuerySchema = Schema.Struct({
  orgId: Schema.optional(Schema.String),
  profileId: Schema.optional(Schema.String),
  surface: Schema.optional(Schema.String),
  field: Schema.optional(Schema.String),
  eventType: Schema.optional(AuditEventTypeSchema),
  result: Schema.optional(AuditResultSchema),
  agentId: Schema.optional(Schema.String),
  itemId: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(
    Schema.Int.pipe(Schema.greaterThanOrEqualTo(1), Schema.lessThanOrEqualTo(100)),
  ),
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
  profileId: Schema.NullOr(Schema.String),
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
  organizationId: NonEmptyString,
  createdBy: NonEmptyString,
  kind: AgentKindSchema,
  locality: Schema.Literal("local", "remote"),
  authMethod: AgentAuthMethodSchema,
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
  organizationId: NonEmptyString,
  agentId: NonEmptyString,
  itemId: NonEmptyString,
  capability: CapabilitySchema,
  expiresAt: NullableIsoDateString,
  grantedBy: NonEmptyString,
  createdAt: IsoDateString,
});

export const AuditEntrySchema = Schema.Struct({
  id: Schema.Int,
  organizationId: NonEmptyString,
  userId: NonEmptyString,
  agentId: Schema.NullOr(Schema.String),
  itemId: Schema.NullOr(Schema.String),
  profileId: Schema.NullOr(Schema.String),
  surface: Schema.NullOr(Schema.String),
  eventType: AuditEventTypeSchema,
  result: AuditResultSchema,
  deliveryMode: Schema.NullOr(Schema.String),
  field: Schema.NullOr(Schema.String),
  purpose: Schema.NullOr(Schema.String),
  meta: JsonRecord,
  ipAddress: Schema.NullOr(Schema.String),
  occurredAt: IsoDateString,
});

export const CiphertextAccessResponseSchema = Schema.Struct({
  encryptedItemKey: NonEmptyString,
  ciphertext: NonEmptyString,
  cryptoVersion: Schema.Int,
  // §W1S7-001 — local agents need these to rebuild the XChaCha20-Poly1305
  // AAD for ZK decryption. The server computes them from the row and returns
  // them verbatim; clients MUST pass them through to the daemon unchanged.
  itemId: NonEmptyString,
  profileId: NonEmptyString,
  contentVersion: Schema.Int.pipe(Schema.positive()),
});

export const RevealAccessResponseSchema = Schema.Struct({
  payload: ItemPayloadSchema,
});

export const ZeroKnowledgeMountAccessResponseSchema = Schema.Struct({
  storageMode: Schema.Literal("zero_knowledge"),
  encryptedItemKey: NonEmptyString,
  ciphertext: NonEmptyString,
  cryptoVersion: Schema.Int,
  // §W1S7-001 — see CiphertextAccessResponseSchema. AAD meta for local decrypt.
  itemId: NonEmptyString,
  profileId: NonEmptyString,
  contentVersion: Schema.Int.pipe(Schema.positive()),
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
