import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateEd25519KeyPair, signEd25519 } from "@abadge/crypto";

/**
 * Daemon identity used for TOFU (trust-on-first-use) peer verification.
 *
 * The CLI pins the fingerprint of `publicKey` on first contact, so a same-UID
 * squatter that binds the socket before the real daemon can't capture the
 * operator's master password. `sessionStartMs` is
 * informational metadata baked into the challenge-response payload so replays
 * across daemon restarts are trivially distinguishable — it is NOT part of the
 * freshness guarantee (the client-supplied nonce provides that).
 */
export interface DaemonIdentity {
  /** Exported JWK JSON (base64 Ed25519 public key). */
  publicKey: string;
  /** Exported JWK JSON — in-memory; also persisted to daemon.key at 0o600. */
  privateKey: string;
  /**
   * Timestamp the daemon loaded / generated this identity (ms since epoch).
   * Bumped on every daemon start even with the same persisted key.
   */
  sessionStartMs: number;
  /** sha256(publicKey JSON), first 16 bytes as lowercase hex (32 chars). */
  fingerprint: string;
}

/**
 * Load an existing daemon keypair from `${homeDir}/daemon.{pub,key}` or
 * generate + persist a fresh one. If either file is missing on restart, both
 * are regenerated so the user is forced to re-pin — partial state is treated
 * as tampering rather than silently patched.
 */
export async function loadOrCreateDaemonIdentity(homeDir: string): Promise<DaemonIdentity> {
  const pubPath = join(homeDir, "daemon.pub");
  const privPath = join(homeDir, "daemon.key");

  if (existsSync(pubPath) && existsSync(privPath)) {
    const publicKey = readFileSync(pubPath, "utf8");
    const privateKey = readFileSync(privPath, "utf8");
    return {
      publicKey,
      privateKey,
      sessionStartMs: Date.now(),
      fingerprint: await computeFingerprint(publicKey),
    };
  }

  const kp = await generateEd25519KeyPair();
  // Public key is not a secret — 0o644 is fine. Private key MUST be 0o600.
  writeFileSync(pubPath, kp.publicKey, { mode: 0o644 });
  writeFileSync(privPath, kp.privateKey, { mode: 0o600 });
  // Belt-and-suspenders: writeFileSync `mode` only applies on creation. If the
  // file already existed under a permissive umask, chmodSync forces 0o600.
  chmodSync(privPath, 0o600);

  return {
    publicKey: kp.publicKey,
    privateKey: kp.privateKey,
    sessionStartMs: Date.now(),
    fingerprint: await computeFingerprint(kp.publicKey),
  };
}

/**
 * Deterministic short identifier for a daemon public key. sha256 over the JWK
 * JSON, first 16 bytes rendered as lowercase hex — same input always produces
 * the same fingerprint, and two keys are colliding with probability ~2^-128.
 */
export async function computeFingerprint(publicKey: string): Promise<string> {
  const bytes = new TextEncoder().encode(publicKey);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest).slice(0, 16))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Sign a CLI-supplied nonce plus the daemon's session-start timestamp. The
 * nonce alone provides freshness; sessionStartMs is included so pre-restart
 * signatures are trivially invalid against a post-restart verifier.
 */
export async function signChallenge(identity: DaemonIdentity, nonce: string): Promise<string> {
  return signEd25519(identity.privateKey, `${nonce}|${identity.sessionStartMs}`);
}
