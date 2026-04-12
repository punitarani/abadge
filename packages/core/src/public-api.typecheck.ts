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

// @ts-expect-error legacy operator-token surface removed
type _LegacyOperatorToken = import("./index").OperatorToken;
// @ts-expect-error legacy operator-token scope removed
type _LegacyOperatorTokenScope = import("./index").OperatorTokenScope;
// @ts-expect-error legacy operator-token creation input removed
type _LegacyCreateOperatorTokenInput = import("./index").CreateOperatorTokenInput;
// @ts-expect-error legacy item display surface removed
type _LegacyItemDisplayEntry = import("./index").ItemDisplayEntry;

export const corePublicApiTypecheck = true;
