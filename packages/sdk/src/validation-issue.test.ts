import { describe, expect, test } from "bun:test";
import { toValidationIssues } from "./validation-issue";

describe("toValidationIssues — happy paths", () => {
  test("returns parsed issues when every element is well-shaped", () => {
    const out = toValidationIssues([
      { path: ["body", "email"], message: "must be an email" },
      { path: ["body", "items", 0, "id"], message: "required" },
    ]);
    expect(out).toEqual([
      { path: ["body", "email"], message: "must be an email" },
      { path: ["body", "items", 0, "id"], message: "required" },
    ]);
  });

  test("empty array returns an empty array, not undefined", () => {
    expect(toValidationIssues([])).toEqual([]);
  });
});

describe("toValidationIssues — adversarial paths return undefined", () => {
  test("non-array input -> undefined", () => {
    expect(toValidationIssues(undefined)).toBeUndefined();
    expect(toValidationIssues(null)).toBeUndefined();
    expect(toValidationIssues({})).toBeUndefined();
    expect(toValidationIssues("string")).toBeUndefined();
    expect(toValidationIssues(42)).toBeUndefined();
  });

  test("any element not an object -> undefined", () => {
    expect(toValidationIssues([null])).toBeUndefined();
    expect(toValidationIssues(["string"])).toBeUndefined();
    expect(toValidationIssues([42])).toBeUndefined();
  });

  test("element missing path -> undefined", () => {
    expect(toValidationIssues([{ message: "x" }])).toBeUndefined();
  });

  test("element missing message -> undefined", () => {
    expect(toValidationIssues([{ path: ["a"] }])).toBeUndefined();
  });

  test("path that isn't an array -> undefined", () => {
    expect(toValidationIssues([{ path: "body.email", message: "x" }])).toBeUndefined();
    expect(toValidationIssues([{ path: 42, message: "x" }])).toBeUndefined();
  });

  test("path containing a non-string/non-number segment -> undefined", () => {
    expect(toValidationIssues([{ path: ["body", true], message: "x" }])).toBeUndefined();
    expect(
      toValidationIssues([{ path: ["body", { nested: true }], message: "x" }]),
    ).toBeUndefined();
  });

  test("non-string message -> undefined", () => {
    expect(toValidationIssues([{ path: ["a"], message: 42 }])).toBeUndefined();
    expect(toValidationIssues([{ path: ["a"], message: null }])).toBeUndefined();
  });

  test("rejects whole array if any element is malformed (no partial parse)", () => {
    expect(
      toValidationIssues([{ path: ["a"], message: "ok" }, { message: "missing path" }]),
    ).toBeUndefined();
  });
});
