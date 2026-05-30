import { describe, expect, test } from "bun:test";
import { deriveKEK, fromBase64, recoverRootKey, unwrapRootKey } from "@abadge/crypto";
import { computeBootstrapMaterial, INITIAL_PROFILE_KEY_VERSION } from "./profile-bootstrap";

describe("computeBootstrapMaterial", () => {
  const profileId = "prf_bootstrap_test";
  const password = "correct horse battery staple";
  const meta = { profileId, keyVersion: INITIAL_PROFILE_KEY_VERSION };

  test("the password-derived KEK unwraps to the SAME root key the recovery key recovers", () => {
    // This is exactly what the daemon's vault.unlock does: derive the KEK from
    // (password, salt, params) and unwrapRootKey with the {profileId, keyVersion}
    // AAD. If this round-trips, unlock will succeed against the bootstrapped row.
    const m = computeBootstrapMaterial(profileId, password);
    const kek = deriveKEK(password, fromBase64(m.kdfSalt), m.kdfParams);
    const viaPassword = unwrapRootKey({ wrapped: m.wrappedRootKey }, kek, meta);
    const viaRecovery = recoverRootKey(m.recoveryKey, { wrapped: m.recoveryWrappedRootKey }, meta);

    expect(viaPassword.length).toBe(32);
    expect(viaPassword).toEqual(viaRecovery);
  });

  test("the wrong password cannot unwrap the root key (AEAD tag fails)", () => {
    const m = computeBootstrapMaterial(profileId, password);
    const wrongKek = deriveKEK("not-the-password", fromBase64(m.kdfSalt), m.kdfParams);
    expect(() => unwrapRootKey({ wrapped: m.wrappedRootKey }, wrongKek, meta)).toThrow();
  });

  test("a wrong AAD (keyVersion) cannot unwrap — binds to {profileId, keyVersion:1}", () => {
    const m = computeBootstrapMaterial(profileId, password);
    const kek = deriveKEK(password, fromBase64(m.kdfSalt), m.kdfParams);
    expect(() =>
      unwrapRootKey({ wrapped: m.wrappedRootKey }, kek, { profileId, keyVersion: 2 }),
    ).toThrow();
  });

  test("each call uses a fresh salt and root key", () => {
    const a = computeBootstrapMaterial(profileId, password);
    const b = computeBootstrapMaterial(profileId, password);
    expect(a.kdfSalt).not.toBe(b.kdfSalt);
    expect(a.wrappedRootKey).not.toBe(b.wrappedRootKey);
    expect(a.recoveryKey).not.toBe(b.recoveryKey);
  });
});
