import { describe, expect, test } from "bun:test";
import { isProfileBootstrapped } from "./onboarding-triage";

const zkUnboot = { id: "p1", storageMode: "zero_knowledge", wrappedRootKey: null } as const;
const zkBoot = { id: "p2", storageMode: "zero_knowledge", wrappedRootKey: "wrap" } as const;
const srvMgd = { id: "p3", storageMode: "server_managed", wrappedRootKey: null } as const;

describe("isProfileBootstrapped", () => {
  test("server_managed profile is always bootstrapped", () => {
    expect(isProfileBootstrapped(srvMgd)).toBe(true);
  });

  test("zero_knowledge profile with wrappedRootKey is bootstrapped", () => {
    expect(isProfileBootstrapped(zkBoot)).toBe(true);
  });

  test("zero_knowledge profile without wrappedRootKey is not bootstrapped", () => {
    expect(isProfileBootstrapped(zkUnboot)).toBe(false);
  });
});
