import { describe, expect, test } from "bun:test";
import { matchesAutoGrant } from "./auto-grant";

const baseCred = {
  environment: "prod" as const,
  tags: ["db", "api"],
  type: "api_key",
  service: "stripe",
  sensitivity: "high",
};

const emptyGrant = {
  matchEnvironment: null,
  matchTags: null,
  matchType: null,
  matchService: null,
  matchSensitivity: null,
};

describe("matchesAutoGrant", () => {
  test("all-null grant matches any credential", () => {
    expect(matchesAutoGrant(baseCred, emptyGrant)).toBe(true);
  });

  test("matching environment passes", () => {
    expect(matchesAutoGrant(baseCred, { ...emptyGrant, matchEnvironment: "prod" })).toBe(true);
  });

  test("wrong environment fails", () => {
    expect(matchesAutoGrant(baseCred, { ...emptyGrant, matchEnvironment: "dev" })).toBe(false);
  });

  test("matching type passes", () => {
    expect(matchesAutoGrant(baseCred, { ...emptyGrant, matchType: "api_key" })).toBe(true);
  });

  test("wrong type fails", () => {
    expect(matchesAutoGrant(baseCred, { ...emptyGrant, matchType: "token" })).toBe(false);
  });

  test("matching service passes", () => {
    expect(matchesAutoGrant(baseCred, { ...emptyGrant, matchService: "stripe" })).toBe(true);
  });

  test("wrong service fails", () => {
    expect(matchesAutoGrant(baseCred, { ...emptyGrant, matchService: "github" })).toBe(false);
  });

  test("matching sensitivity passes", () => {
    expect(matchesAutoGrant(baseCred, { ...emptyGrant, matchSensitivity: "high" })).toBe(true);
  });

  test("wrong sensitivity fails", () => {
    expect(matchesAutoGrant(baseCred, { ...emptyGrant, matchSensitivity: "low" })).toBe(false);
  });

  test("matching tags subset passes", () => {
    expect(matchesAutoGrant(baseCred, { ...emptyGrant, matchTags: ["db"] })).toBe(true);
  });

  test("all matching tags passes", () => {
    expect(matchesAutoGrant(baseCred, { ...emptyGrant, matchTags: ["db", "api"] })).toBe(true);
  });

  test("missing tag fails", () => {
    expect(matchesAutoGrant(baseCred, { ...emptyGrant, matchTags: ["db", "missing"] })).toBe(false);
  });

  test("empty matchTags array passes", () => {
    expect(matchesAutoGrant(baseCred, { ...emptyGrant, matchTags: [] })).toBe(true);
  });

  test("credential with null tags fails when matchTags is non-empty", () => {
    const cred = { ...baseCred, tags: null };
    expect(matchesAutoGrant(cred, { ...emptyGrant, matchTags: ["db"] })).toBe(false);
  });

  test("multiple criteria must all match (conjunction)", () => {
    const grant = {
      matchEnvironment: "prod",
      matchType: "api_key",
      matchService: "stripe",
      matchSensitivity: "high",
      matchTags: ["db"],
    };
    expect(matchesAutoGrant(baseCred, grant)).toBe(true);
  });

  test("one failing criterion in conjunction fails the whole match", () => {
    const grant = {
      matchEnvironment: "prod",
      matchType: "api_key",
      matchService: "github", // wrong
      matchSensitivity: "high",
      matchTags: null,
    };
    expect(matchesAutoGrant(baseCred, grant)).toBe(false);
  });

  test("credential with null environment passes when grant has null matchEnvironment", () => {
    const cred = { ...baseCred, environment: null };
    expect(matchesAutoGrant(cred, emptyGrant)).toBe(true);
  });

  test("credential with null environment fails when grant requires specific environment", () => {
    const cred = { ...baseCred, environment: null };
    expect(matchesAutoGrant(cred, { ...emptyGrant, matchEnvironment: "prod" })).toBe(false);
  });
});
