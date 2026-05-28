import type { AbadgeApiError } from "./errors";
import {
  Abadge,
  type AbadgeAgentClient,
  type AbadgeAgentClientConfig,
  type AbadgeAgentKeypairConfig,
  type AbadgeUserClient,
  type AbadgeUserClientConfig,
  type CreateAgentInput,
  type CreatePermissionInput,
  type ErrorCode,
  type Permission,
  type PermissionFilters,
  type resolveFieldValue,
  type SecretValue,
} from "./index";

type Assert<T extends true> = T;

// -- Backward-compat type assertions (existing) ----------------------------

type _PermissionUsesAgentId = Assert<Permission["agentId"] extends string ? true : false>;
type _AgentCreateInput = Assert<CreateAgentInput["kind"] extends string ? true : false>;
type _PermissionFilters = Assert<
  PermissionFilters["agentId"] extends string | undefined ? true : false
>;
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
// @ts-expect-error AbadgeClientConfig removed — use AbadgeUserClientConfig or AbadgeAgentClientConfig
type _LegacyAbadgeClientConfig = import("./index").AbadgeClientConfig;
// @ts-expect-error PrincipalAuthMethod renamed to AgentAuthMethod
type _LegacyPrincipalAuthMethod = import("./index").PrincipalAuthMethod;

// -- Client split assertions -----------------------------------------------

type _UserClientConfig = Assert<
  AbadgeUserClientConfig extends { apiUrl: string; sessionToken: string } ? true : false
>;
type _AgentKeypairConfigShape = Assert<
  AbadgeAgentKeypairConfig extends { apiUrl: string; agentId: string } ? true : false
>;
// AbadgeAgentClientConfig is the keypair config (legacy API-key auth removed).
type _AgentClientConfigIsKeypair = Assert<
  AbadgeAgentClientConfig extends AbadgeAgentKeypairConfig ? true : false
>;

// Abadge namespace exposes both client constructors (runtime + type check).
type _AbadgeNamespaceHasUser = Assert<
  typeof Abadge.User extends typeof AbadgeUserClient ? true : false
>;
type _AbadgeNamespaceHasAgent = Assert<
  typeof Abadge.Agent extends typeof AbadgeAgentClient ? true : false
>;
// Reference the runtime values so the import is not narrowed to `import type`.
export const _abadgeNamespaceRuntime = { User: Abadge.User, Agent: Abadge.Agent } as const;

// @ts-expect-error createItem removed — use user.items.create
type _LegacyCreateItem = AbadgeUserClient["createItem"];
// @ts-expect-error createAgent removed — use user.agents.create
type _LegacyCreateAgent = AbadgeUserClient["createAgent"];
// @ts-expect-error createPermission removed — use user.permissions.create
type _LegacyCreatePermission = AbadgeUserClient["createPermission"];
// @ts-expect-error getAudit removed from the user client — use user.audit.list
type _LegacyUserGetAudit = AbadgeUserClient["getAudit"];
// @ts-expect-error accessReveal removed — use agent.access.read
type _LegacyAccessReveal = AbadgeAgentClient["accessReveal"];
// @ts-expect-error accessMount removed — use agent.access.use
type _LegacyAccessMount = AbadgeAgentClient["accessMount"];
// @ts-expect-error accessCiphertext removed — use agent.access.read
type _LegacyAccessCiphertext = AbadgeAgentClient["accessCiphertext"];
// @ts-expect-error bulkAccessMountEnv removed — use agent.access.useProfile
type _LegacyBulkAccessMountEnv = AbadgeAgentClient["bulkAccessMountEnv"];
type _UserHasItemsCreate = Assert<
  AbadgeUserClient["items"]["create"] extends (...args: never[]) => Promise<{ id: string }>
    ? true
    : false
>;
type _AgentHasAccessRead = Assert<
  AbadgeAgentClient["access"]["read"] extends (...args: never[]) => Promise<unknown> ? true : false
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
type _IssuesIsReadonlyArray = Assert<
  AbadgeApiError["issues"] extends
    | ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>
    | undefined
    ? true
    : false
>;
type _ErrorCodeIncludesKnown = Assert<"VAULT_NOT_FOUND" extends ErrorCode ? true : false>;
type _ErrorCodeIncludesForbidden = Assert<"FORBIDDEN" extends ErrorCode ? true : false>;
type _SecretValueExpose = Assert<ReturnType<SecretValue["expose"]> extends string ? true : false>;
type _ResolveFieldValue = Assert<
  ReturnType<typeof resolveFieldValue> extends string ? true : false
>;

export const sdkPublicApiTypecheck = true;
