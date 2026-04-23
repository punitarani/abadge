import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyEd25519 } from "@abadge/crypto";
import { computeFingerprint, loadOrCreateDaemonIdentity, signChallenge } from "./identity";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function allocHomeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "abadge-identity-"));
  tempDirs.push(dir);
  // mkdtempSync doesn't guarantee 0o700 on every platform, and the identity
  // module doesn't enforce parent-dir perms (that's the server's job), so we
  // just tighten it here to keep test artefacts sane.
  chmodSync(dir, 0o700);
  return dir;
}

describe("loadOrCreateDaemonIdentity", () => {
  test("generates a fresh keypair on first call and persists daemon.pub / daemon.key", async () => {
    const home = allocHomeDir();
    const identity = await loadOrCreateDaemonIdentity(home);

    expect(identity.publicKey).toBeTruthy();
    expect(identity.privateKey).toBeTruthy();
    expect(identity.sessionStartMs).toBeGreaterThan(0);
    expect(identity.fingerprint).toMatch(/^[0-9a-f]{32}$/);

    // Files should exist, private key 0o600.
    expect(existsSync(join(home, "daemon.pub"))).toBe(true);
    expect(existsSync(join(home, "daemon.key"))).toBe(true);
    const privMode = statSync(join(home, "daemon.key")).mode & 0o777;
    expect(privMode).toBe(0o600);
  });

  test("reuses persisted keypair on second call — public key is stable across restarts", async () => {
    const home = allocHomeDir();
    const first = await loadOrCreateDaemonIdentity(home);
    const second = await loadOrCreateDaemonIdentity(home);

    expect(second.publicKey).toBe(first.publicKey);
    expect(second.privateKey).toBe(first.privateKey);
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  test("regenerates a fresh keypair when daemon.pub is deleted (partial state = tampering)", async () => {
    const home = allocHomeDir();
    const first = await loadOrCreateDaemonIdentity(home);

    rmSync(join(home, "daemon.pub"));
    const second = await loadOrCreateDaemonIdentity(home);

    expect(second.publicKey).not.toBe(first.publicKey);
    expect(second.fingerprint).not.toBe(first.fingerprint);
  });

  test("regenerates a fresh keypair when daemon.key is deleted", async () => {
    const home = allocHomeDir();
    const first = await loadOrCreateDaemonIdentity(home);

    rmSync(join(home, "daemon.key"));
    const second = await loadOrCreateDaemonIdentity(home);

    expect(second.publicKey).not.toBe(first.publicKey);
  });
});

describe("computeFingerprint", () => {
  test("is deterministic for the same input", async () => {
    const input = '{"kty":"OKP","crv":"Ed25519","x":"abc"}';
    const a = await computeFingerprint(input);
    const b = await computeFingerprint(input);
    expect(a).toBe(b);
  });

  test("returns 32 lowercase hex chars (16 bytes)", async () => {
    const input = '{"kty":"OKP","crv":"Ed25519","x":"def"}';
    const fp = await computeFingerprint(input);
    expect(fp).toMatch(/^[0-9a-f]{32}$/);
  });

  test("differs for different inputs", async () => {
    const a = await computeFingerprint('{"kty":"OKP","crv":"Ed25519","x":"a"}');
    const b = await computeFingerprint('{"kty":"OKP","crv":"Ed25519","x":"b"}');
    expect(a).not.toBe(b);
  });
});

describe("signChallenge", () => {
  test("produces a signature verifiable under the identity's public key", async () => {
    const home = allocHomeDir();
    const identity = await loadOrCreateDaemonIdentity(home);
    const nonce = "test-nonce-12345";

    const sig = await signChallenge(identity, nonce);
    const ok = await verifyEd25519(identity.publicKey, `${nonce}|${identity.sessionStartMs}`, sig);
    expect(ok).toBe(true);
  });

  test("a signature over one nonce does NOT verify against a different nonce", async () => {
    const home = allocHomeDir();
    const identity = await loadOrCreateDaemonIdentity(home);
    const sig = await signChallenge(identity, "nonce-A");
    const ok = await verifyEd25519(identity.publicKey, `nonce-B|${identity.sessionStartMs}`, sig);
    expect(ok).toBe(false);
  });
});
