/**
 * Environment variables whose values are interpreted by the OS loader,
 * language runtime, or shell startup BEFORE user code runs. Injecting
 * secrets into any of these escalates from "agent has a secret" to
 * "arbitrary code execution under the spawning process's UID."
 *
 * Used by:
 *   - packages/daemon/src/server.ts (exec.env / exec.expandEnv RPCs)
 *   - packages/mcp/src/tools/run-with-secret.ts (direct Node spawn)
 *
 * Adding new entries: the bar is "a concrete escalation path under
 * commonly-available runtimes." Don't cargo-cult entries; each one
 * must have a named exploit. Adversarial survey iter 10 (audit
 * W3P10-001) identified this set as minimum coverage.
 */
export const RESERVED_ENV_KEYS: ReadonlySet<string> = new Set([
  "PATH",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "LD_AUDIT",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "DYLD_FORCE_FLAT_NAMESPACE",
  "NODE_OPTIONS",
  "BUN_INSTALL",
  "BUN_CONFIG_REGISTRY",
  "PYTHONPATH",
  "PYTHONSTARTUP",
  "HOME",
  "USER",
  "SHELL",
  // Node.js bare-import resolution path (analog of PYTHONPATH).
  "NODE_PATH",
  // TLS trust / proxy hijack: redirect or MITM outbound TLS from the child.
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  // Shell loader hijack: alter startup or word-splitting of a spawned shell.
  "BASH_ENV",
  "ENV",
  "IFS",
]);

/** Shell-safe env var name: POSIX identifier (matches daemon's ENV_KEY_PATTERN). */
export const ENV_VAR_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

/**
 * Validate an environment variable name before injecting a secret into it.
 *
 * Returns ok=true when the name is safe to use, or ok=false with a reason
 * indicating whether the name is malformed or reserved. Callers are responsible
 * for translating this into their own error shape (JSON-RPC error for daemon,
 * plain Error for MCP).
 */
export function validateEnvVarName(
  name: string,
): { ok: true } | { ok: false; reason: "invalid_format" | "reserved" } {
  if (!ENV_VAR_NAME_PATTERN.test(name)) {
    return { ok: false, reason: "invalid_format" };
  }
  if (RESERVED_ENV_KEYS.has(name)) {
    return { ok: false, reason: "reserved" };
  }
  return { ok: true };
}
