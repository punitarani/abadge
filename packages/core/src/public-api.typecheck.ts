import { BadRequestError } from "./index";

new BadRequestError({
  code: "BAD_REQUEST",
  message: "Missing input",
  hint: "Check the invalid input and try again.",
});

// @ts-expect-error hint is required on base domain errors
new BadRequestError({
  code: "BAD_REQUEST",
  message: "Missing input",
});

// These names are deliberately not part of the public API; the expect-errors
// fail the build if any are reintroduced as exports.
// @ts-expect-error not exported: no operator-token surface
type _LegacyOperatorToken = import("./index").OperatorToken;
// @ts-expect-error not exported: no operator-token scope
type _LegacyOperatorTokenScope = import("./index").OperatorTokenScope;
// @ts-expect-error not exported: no operator-token creation input
type _LegacyCreateOperatorTokenInput = import("./index").CreateOperatorTokenInput;
// @ts-expect-error not exported: no item display surface
type _LegacyItemDisplayEntry = import("./index").ItemDisplayEntry;
// @ts-expect-error not exported: agent auth method type is AgentAuthMethod
type _LegacyPrincipalAuthMethod = import("./index").PrincipalAuthMethod;
// @ts-expect-error not exported: agent auth methods constant is AGENT_AUTH_METHODS
type _LegacyPrincipalAuthMethods = typeof import("./index").PRINCIPAL_AUTH_METHODS;

export const corePublicApiTypecheck = true;
