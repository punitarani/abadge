import type {
  Agent,
  AgentWithKey,
  CreateAgentInput,
  CreatePermissionInput,
  Permission,
  PermissionFilters,
} from "./index";

type Assert<T extends true> = T;

type _AgentHasKeyPrefix = Assert<Agent["keyPrefix"] extends string | null ? true : false>;
type _PermissionUsesAgentId = Assert<Permission["agentId"] extends string ? true : false>;
type _AgentCreateInput = Assert<CreateAgentInput["kind"] extends string ? true : false>;
type _PermissionFilters = Assert<
  PermissionFilters["agentId"] extends string | undefined ? true : false
>;
type _AgentWithKeyUsesApiKey = Assert<AgentWithKey["apiKey"] extends string ? true : false>;
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

export const sdkPublicApiTypecheck = true;
