import { Schema } from "effect";
import {
  AGENT_AUTH_METHODS,
  AGENT_KINDS,
  AUDIT_EVENT_TYPES,
  AUDIT_RESULTS,
  CANONICAL_CAPABILITIES,
  CAPABILITIES,
  ITEM_KINDS,
  MAX_AGENT_METADATA_DEPTH,
  MAX_AGENT_METADATA_JSON_BYTES,
  STORAGE_MODES,
} from "./constants";

const NonEmptyString = Schema.String.pipe(Schema.minLength(1));

/**
 * Client-provided UUID for ZK item create. The itemId is bound into the
 * XChaCha20-Poly1305 AAD at encrypt time, so the client must choose the id
 * before wrapping the payload. The server maps an insert-time unique-violation
 * to a ConflictError so two clients racing with the same UUID see a domain
 * error rather than a 500.
 */
const UuidString = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
);

// Iterative depth check: avoids stack-overflow on adversarial input.
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

// Reject names that are pure whitespace or contain zero-width / bidi-control
// characters commonly used to disguise identifiers. maxLength is 255 to match
// the stored column width.
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

// publicKey must be a JSON-serialised JWK with kty:"OKP" and crv:"Ed25519".
// Callers store JSON.stringify(crypto.subtle.exportKey("jwk", ...)), which
// produces ~111-char strings like
// {"crv":"Ed25519","ext":true,"key_ops":["verify"],"kty":"OKP","x":"..."}.
// Validate structure rather than a raw base64url pattern.
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
/**
 * Canonical capabilities only. New API surfaces should validate with this
 * schema; legacy capability aliases are accepted via `CapabilitySchema`.
 */
export const CanonicalCapabilitySchema = Schema.Literal(...CANONICAL_CAPABILITIES);
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
  // Client-provided id, bound into the XChaCha20-Poly1305 AAD at encrypt time
  // (see `buildZkContentAad` / `buildZkDekWrapAad`), so the server MUST insert
  // it verbatim. Any server-side replacement would break the AAD binding and
  // make the item undecryptable.
  id: UuidString,
  // Optional explicit target profile. Omitted resolves the org's first
  // zero_knowledge profile. When set it MUST be a zero_knowledge profile in the
  // caller's org; the client must have wrapped the DEK under that profile's
  // root key.
  profileId: Schema.optional(UuidString),
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
  // Optional explicit target profile. Omitted resolves the org's default
  // server_managed profile. Must be a server_managed profile in the caller's org.
  profileId: Schema.optional(UuidString),
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
  publicKey: Schema.optional(AgentPublicKeyString), // JWK format
  issueBootstrapToken: Schema.optional(Schema.Boolean),
  metadata: Schema.optional(JsonRecord),
});

export const CreateAgentSchema = CreateAgentSchemaBase.pipe(
  Schema.filter((input) => {
    // Reject the ambiguous combo of BOTH publicKey and issueBootstrapToken.
    // Callers must specify exactly one. (All agents are public_key_session;
    // authMethod is optional.)
    if (input.publicKey && input.issueBootstrapToken === true) {
      return "Specify either publicKey OR issueBootstrapToken, not both.";
    }

    // Bound metadata size by JSON.stringify length (UTF-16 code units;
    // TextEncoder is unavailable in an Effect Schema filter, which runs in both
    // browser and CF Workers). Code-unit length is a usable proxy for UTF-8
    // bytes; this 16 KB cap is a soft guard, with a body-limit middleware
    // enforcing the hard ceiling. Depth check runs first so a pathological tree
    // cannot stack-overflow stringify.
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
  publicKey: AgentPublicKeyString, // JWK format validation
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

const CreatePermissionCapabilities = Schema.NonEmptyArray(CapabilitySchema).pipe(
  Schema.filter((arr) =>
    new Set(arr).size === arr.length ? undefined : "capabilities must not contain duplicates",
  ),
);

/**
 * A permission grant targets EXACTLY one of (item, profile). The discriminated
 * union mirrors the storage-layer CHECK constraint so the router cannot
 * construct an illegal row. Capabilities accept both legacy aliases and the
 * canonical pair (`CapabilitySchema`); legacy aliases map to canonical at
 * access time via `LEGACY_TO_CANONICAL`.
 */
export const CreateItemPermissionSchema = Schema.Struct({
  agentId: NonEmptyString,
  itemId: NonEmptyString,
  capabilities: CreatePermissionCapabilities,
  expiresAt: Schema.optional(IsoDateString),
});

export const CreateProfilePermissionSchema = Schema.Struct({
  agentId: NonEmptyString,
  profileId: NonEmptyString,
  capabilities: CreatePermissionCapabilities,
  expiresAt: Schema.optional(IsoDateString),
});

export const CreatePermissionSchema = Schema.Union(
  CreateItemPermissionSchema,
  CreateProfilePermissionSchema,
);

/**
 * Unified access shapes. `read` returns either a server-decrypted payload or a
 * ZK envelope for client decrypt; `use` returns an opaque mount handle with an
 * expiry. There is no profile-target read shape: "read a whole profile" has no
 * single canonical response, so profile grants gate per-item access at the
 * policy layer instead.
 */
export const ReadAccessSchema = Schema.Struct({
  itemId: NonEmptyString,
  field: Schema.optional(NonEmptyString),
  purpose: Schema.optional(NonEmptyString),
});

export const UseAccessSchema = Schema.Struct({
  itemId: NonEmptyString,
  delivery: Schema.Literal("env", "file"),
  field: Schema.optional(NonEmptyString),
  envVarName: Schema.optional(NonEmptyString),
  purpose: Schema.optional(NonEmptyString),
});

export const ProfileUseAccessSchema = Schema.Struct({
  profileId: NonEmptyString,
  delivery: Schema.Literal("env", "file"),
  purpose: Schema.optional(NonEmptyString),
});

export const ReadAccessResponseSchema = Schema.Union(
  Schema.Struct({
    storageMode: Schema.Literal("server_managed"),
    payload: ItemPayloadSchema,
  }),
  Schema.Struct({
    storageMode: Schema.Literal("zero_knowledge"),
    encryptedItemKey: NonEmptyString,
    ciphertext: NonEmptyString,
    cryptoVersion: Schema.Number,
    itemId: NonEmptyString,
    profileId: NonEmptyString,
    contentVersion: Schema.Number,
  }),
);

export const UseAccessResponseSchema = Schema.Struct({
  mountId: NonEmptyString,
  delivery: Schema.Literal("env", "file"),
  expiresAt: IsoDateString,
});

/**
 * Redeem a previously-minted mount handle. The local daemon (or any
 * authenticated local agent) atomically marks the reservation consumed and
 * receives the actual envelope / decrypted payload. Cross-agent or repeated
 * redemption returns NOT_FOUND.
 */
export const RedeemMountSchema = Schema.Struct({
  mountId: NonEmptyString,
});

export const RedeemMountResponseSchema = Schema.Union(
  Schema.Struct({
    storageMode: Schema.Literal("server_managed"),
    delivery: Schema.Literal("env", "file"),
    payload: ItemPayloadSchema,
    label: NonEmptyString,
    itemId: NonEmptyString,
  }),
  Schema.Struct({
    storageMode: Schema.Literal("zero_knowledge"),
    delivery: Schema.Literal("env", "file"),
    encryptedItemKey: NonEmptyString,
    ciphertext: NonEmptyString,
    cryptoVersion: Schema.Number,
    contentVersion: Schema.Number,
    label: NonEmptyString,
    itemId: NonEmptyString,
    profileId: NonEmptyString,
  }),
);

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
  // Stable, customer/tenant-supplied identifier scoped per-org (partial-unique
  // index, NULL allowed). The auto-default profile created with each org has
  // `externalId: "default"`.
  externalId: Schema.NullOr(Schema.String),
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
  // Surfaced on summaries so the dashboard's profile-grant blast-radius dialog
  // can count items in a profile without fetching detail rows. Nullable because
  // an item can sit at the org root until it is assigned to a profile.
  profileId: Schema.NullOr(Schema.String),
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
  // Null when the creating user has been deleted; the agent is orphaned but
  // stays org-scoped and usable.
  createdBy: Schema.NullOr(NonEmptyString),
  kind: AgentKindSchema,
  locality: Schema.Literal("local", "remote"),
  authMethod: AgentAuthMethodSchema,
  name: NonEmptyString,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  publicKeyConfigured: Schema.Boolean,
  enabled: Schema.Boolean,
  revokedAt: Schema.NullOr(IsoDateString),
  lastUsedAt: Schema.NullOr(IsoDateString),
  metadata: JsonRecord,
  createdAt: IsoDateString,
});

export const AgentRegistrationResultSchema = Schema.Struct({
  agent: AgentSchema,
  bootstrapToken: Schema.NullOr(Schema.String),
  bootstrapExpiresAt: Schema.NullOr(IsoDateString),
});

export const AgentWithKeySchema = AgentRegistrationResultSchema;

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

// ---------------------------------------------------------------------------
// auth.md agentic registration (anonymous → user-claimed OTP flow)
// ---------------------------------------------------------------------------

const EmailString = Schema.String.pipe(
  Schema.pattern(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, { message: () => "Must be a valid email address." }),
  Schema.maxLength(320),
);

/** `POST /agent/auth` — only the anonymous credential type is supported. */
export const AgentRegisterAnonymousSchema = Schema.Struct({
  type: Schema.optional(Schema.Literal("anonymous")),
  requested_credential_type: Schema.optional(Schema.Literal("api_key")),
});
export type AgentRegisterAnonymousInput = Schema.Schema.Type<typeof AgentRegisterAnonymousSchema>;

export const AgentRegisterAnonymousResultSchema = Schema.Struct({
  registration_id: NonEmptyString,
  registration_type: Schema.Literal("anonymous"),
  credential_type: Schema.Literal("api_key"),
  credential: NonEmptyString,
  credential_expires: Schema.Null,
  scopes: Schema.Array(Schema.String),
  claim_url: NonEmptyString,
  claim_token: NonEmptyString,
  claim_token_expires: IsoDateString,
  post_claim_scopes: Schema.Array(Schema.String),
});

/** `POST /agent/auth/claim` — agent supplies the human's email to trigger an OTP. */
export const AgentClaimSchema = Schema.Struct({
  claim_token: NonEmptyString,
  email: EmailString,
});
export type AgentClaimInput = Schema.Schema.Type<typeof AgentClaimSchema>;

export const AgentClaimResultSchema = Schema.Struct({
  registration_id: NonEmptyString,
  claim_attempt_id: NonEmptyString,
  status: Schema.Literal("initiated"),
  expires_at: IsoDateString,
});

/** `POST /agent/auth/claim/complete` — agent relays the human's OTP. */
export const AgentClaimCompleteSchema = Schema.Struct({
  claim_token: NonEmptyString,
  otp: Schema.String.pipe(Schema.pattern(/^\d{6}$/, { message: () => "OTP must be 6 digits." })),
});
export type AgentClaimCompleteInput = Schema.Schema.Type<typeof AgentClaimCompleteSchema>;

export const AgentClaimCompleteResultSchema = Schema.Struct({
  registration_id: NonEmptyString,
  status: Schema.Literal("claimed"),
});

/**
 * Personal user API key (`abu_`). Bound to a (user, org) pair; authenticates the
 * management surface only. The secret is returned exactly once at creation and
 * never persisted in plaintext — only its SHA-256 hash and 8-char prefix are
 * stored. The wire shapes below never include the secret except in
 * `UserApiKeyWithSecretSchema.key` (the one-time reveal).
 */
export const CreateUserApiKeySchema = Schema.Struct({
  name: BoundedNameString,
  // Optional absolute expiry (ISO 8601). Omitted = non-expiring until revoked.
  expiresAt: Schema.optional(IsoDateString),
});

export const UserApiKeySchema = Schema.Struct({
  id: NonEmptyString,
  organizationId: NonEmptyString,
  userId: NonEmptyString,
  name: NonEmptyString,
  keyPrefix: NonEmptyString,
  enabled: Schema.Boolean,
  revokedAt: NullableIsoDateString,
  expiresAt: NullableIsoDateString,
  lastUsedAt: NullableIsoDateString,
  createdAt: IsoDateString,
});

export const UserApiKeyWithSecretSchema = Schema.Struct({
  apiKey: UserApiKeySchema,
  // The full `abu_…` token, shown once at creation.
  key: NonEmptyString,
});

export const UserApiKeyListResultSchema = Schema.Struct({
  apiKeys: Schema.Array(UserApiKeySchema),
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

/**
 * A permission row's target is nullable on both columns: each row sets exactly
 * one of (itemId, profileId), enforced by the DB CHECK. The wire shape mirrors
 * the row shape so callers can branch on which is null.
 */
export const PermissionSchema = Schema.Struct({
  id: NonEmptyString,
  organizationId: NonEmptyString,
  agentId: NonEmptyString,
  itemId: Schema.NullOr(NonEmptyString),
  profileId: Schema.NullOr(NonEmptyString),
  capability: CapabilitySchema,
  expiresAt: NullableIsoDateString,
  // Null when the granting user has been deleted; the grant survives its granter.
  grantedBy: Schema.NullOr(NonEmptyString),
  createdAt: IsoDateString,
});

export const AuditEntrySchema = Schema.Struct({
  id: Schema.Int,
  organizationId: NonEmptyString,
  // Null for an orphaned agent's actions, which have no actor-user.
  userId: Schema.NullOr(NonEmptyString),
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
  // Local agents need these to rebuild the XChaCha20-Poly1305 AAD for ZK
  // decryption. The server computes them from the row and returns them
  // verbatim; clients MUST pass them through to the daemon unchanged.
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
  // AAD meta for local ZK decrypt — see CiphertextAccessResponseSchema.
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

export const BulkMountEnvSchema = Schema.Struct({
  profileId: NonEmptyString,
});

const BulkMountEnvItemBaseFields = {
  itemId: NonEmptyString,
  label: NonEmptyString,
} as const;

const ZeroKnowledgeBulkMountEnvItemSchema = Schema.Struct({
  ...BulkMountEnvItemBaseFields,
  storageMode: Schema.Literal("zero_knowledge"),
  encryptedItemKey: NonEmptyString,
  ciphertext: NonEmptyString,
  cryptoVersion: Schema.Int,
  profileId: NonEmptyString,
  contentVersion: Schema.Int.pipe(Schema.positive()),
});

const ServerManagedBulkMountEnvItemSchema = Schema.Struct({
  ...BulkMountEnvItemBaseFields,
  storageMode: Schema.Literal("server_managed"),
  payload: ItemPayloadSchema,
});

export const BulkMountEnvItemSchema = Schema.Union(
  ZeroKnowledgeBulkMountEnvItemSchema,
  ServerManagedBulkMountEnvItemSchema,
);

export const BulkMountEnvResponseSchema = Schema.Struct({
  items: Schema.Array(BulkMountEnvItemSchema),
});

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
  // Keyset pagination cursor; null when this is the last page.
  nextCursor: Schema.NullOr(Schema.String),
});

export const AgentResultSchema = Schema.Struct({
  agent: AgentSchema,
});

export const AgentListResultSchema = Schema.Struct({
  agents: Schema.Array(AgentSchema),
  // Keyset pagination cursor; null when this is the last page.
  nextCursor: Schema.NullOr(Schema.String),
});

export const PermissionListResultSchema = Schema.Struct({
  permissions: Schema.Array(PermissionSchema),
  // Keyset pagination cursor; null when this is the last page.
  nextCursor: Schema.NullOr(Schema.String),
});

export const AuditListResultSchema = Schema.Struct({
  entries: Schema.Array(AuditEntrySchema),
  nextCursor: Schema.NullOr(Schema.String),
});
