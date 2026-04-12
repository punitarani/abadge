import type { AbadgeApiError } from "./errors";
import type {
  AbadgeAgentApiKeyConfig,
  AbadgeAgentClient,
  AbadgeAgentClientConfig,
  AbadgeAgentKeypairConfig,
  AbadgeClientConfig,
  AbadgeUserClient,
  AbadgeUserClientConfig,
  Agent,
  AgentWithKey,
  CreateAgentInput,
  CreatePermissionInput,
  ErrorCode,
  Permission,
  PermissionFilters,
  resolveFieldValue,
  SecretValue,
} from "./index";

type Assert<T extends true> = T;

// -- Backward-compat type assertions (existing) ----------------------------

type _AgentHasKeyPrefix = Assert<Agent["keyPrefix"] extends string | null ? true : false>;
type _PermissionUsesAgentId = Assert<Permission["agentId"] extends string ? true : false>;
type _AgentCreateInput = Assert<CreateAgentInput["kind"] extends string ? true : false>;
type _PermissionFilters = Assert<
  PermissionFilters["agentId"] extends string | undefined ? true : false
>;
type _AgentWithKeyUsesApiKey = Assert<AgentWithKey["apiKey"] extends string | null ? true : false>;
type _PermissionCreateInput = Assert<
  CreatePermissionInput["agentId"] extends string ? true : false
>;

// @ts-expect-error legacy export removed
type _LegacyPrincipal = import("./index").Principal;
// @ts-expect-error legacy export removed
type _LegacyGrant = import("./index").Grant;
// @ts-expect-error legacy export removed
type _LegacyCreatePrincipalInput = import("./index").CreatePrincipalInput;
// @ts-expect-error legacy export removed
type _LegacyCreateGrantInput = import("./index").CreateGrantInput;
// @ts-expect-error legacy export removed
type _LegacyGrantFilters = import("./index").GrantFilters;
// @ts-expect-error legacy operator-token export removed
type _LegacyOperatorToken = import("./index").OperatorToken;
// @ts-expect-error legacy operator-token creation input removed
type _LegacyCreateOperatorTokenInput = import("./index").CreateOperatorTokenInput;
// @ts-expect-error legacy operator-token revoke input removed
type _LegacyRevokeOperatorTokenInput = import("./index").RevokeOperatorTokenInput;
// @ts-expect-error AbadgeClient removed — use AbadgeUserClient or AbadgeAgentClient
type _LegacyAbadgeClient = import("./index").AbadgeClient;

// -- Client split assertions -----------------------------------------------

type _UserClientConfig = Assert<
  AbadgeUserClientConfig extends { apiUrl: string; sessionToken: string } ? true : false
>;
type _AgentApiKeyConfigShape = Assert<
  AbadgeAgentApiKeyConfig extends { apiUrl: string; apiKey: string } ? true : false
>;
type _AgentKeypairConfigShape = Assert<
  AbadgeAgentKeypairConfig extends { apiUrl: string; agentId: string } ? true : false
>;
type _LegacyClientConfig = Assert<
  AbadgeClientConfig extends { apiUrl: string; token: string } ? true : false
>;

// AbadgeAgentClientConfig is the union of keypair and apikey configs
type _AgentClientConfigIsUnion = Assert<
  AbadgeAgentClientConfig extends AbadgeAgentKeypairConfig | AbadgeAgentApiKeyConfig ? true : false
>;

type _UserHasCreateItem = Assert<
  AbadgeUserClient["createItem"] extends (...args: never[]) => Promise<{ id: string }>
    ? true
    : false
>;
type _AgentHasAccessReveal = Assert<
  AbadgeAgentClient["accessReveal"] extends (...args: never[]) => Promise<unknown> ? true : false
>;
type _AgentHasGetCurrentAgent = Assert<
  AbadgeAgentClient["getCurrentAgent"] extends () => Promise<unknown> ? true : false
>;
type _AgentHasConnect = Assert<
  AbadgeAgentClient["connect"] extends () => Promise<void> ? true : false
>;
type _AgentHasDisconnect = Assert<
  AbadgeAgentClient["disconnect"] extends () => void ? true : false
>;

// -- ErrorCode typing assertions -------------------------------------------

type _ErrorCodeIsTyped = Assert<AbadgeApiError["code"] extends ErrorCode | string ? true : false>;
type _ErrorCodeIncludesKnown = Assert<"VAULT_NOT_FOUND" extends ErrorCode ? true : false>;
type _ErrorCodeIncludesForbidden = Assert<"FORBIDDEN" extends ErrorCode ? true : false>;
type _SecretValueReveal = Assert<ReturnType<SecretValue["reveal"]> extends string ? true : false>;
type _ResolveFieldValue = Assert<
  ReturnType<typeof resolveFieldValue> extends string ? true : false
>;

export const sdkPublicApiTypecheck = true;
