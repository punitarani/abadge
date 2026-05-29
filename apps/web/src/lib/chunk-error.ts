/**
 * Stale-deploy chunk recovery.
 *
 * Next.js emits content-hashed JS/CSS chunks (e.g. `1627-d5ca38969cf61712.js`)
 * and replaces them on every deploy. A browser tab still running an older build
 * holds a manifest pointing at the previous hashes; when it lazy-loads a route
 * whose chunk hash has changed, the dynamic `import()` 404s and React throws a
 * `ChunkLoadError`. The fix is a single hard reload, which fetches fresh HTML +
 * manifest referencing the live chunks. Re-rendering (the error boundary's
 * `reset()`) cannot help — it re-attempts the same dead import.
 */

const RELOAD_GUARD_KEY = "abadge:chunk-reload-at";

// Window during which a second chunk failure is treated as "reload didn't help"
// rather than a fresh stale-deploy, so we never trap the user in a reload loop.
const RELOAD_GUARD_MS = 10_000;

/**
 * True when `error` is a failed chunk/dynamic-import load. Covers the webpack
 * `ChunkLoadError` (JS and CSS chunks) and the native dynamic-import failures
 * surfaced by different browsers.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  const name = typeof error === "object" && "name" in error ? String(error.name) : "";
  if (name === "ChunkLoadError") {
    return true;
  }

  const message =
    typeof error === "string"
      ? error
      : typeof error === "object" && "message" in error
        ? String(error.message)
        : "";

  return (
    /Loading (?:CSS )?chunk [^\s]+ failed/i.test(message) ||
    /ChunkLoadError/i.test(message) ||
    // Native dynamic import failures (Chromium / Firefox / Safari wording).
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message)
  );
}

/**
 * Reload the page once to recover from a stale-deploy chunk error. Guarded by a
 * sessionStorage timestamp so a chunk error that survives the reload (a genuine
 * bug, not a stale deploy) falls through to the error UI instead of looping.
 *
 * Returns `true` when a reload was triggered, `false` when suppressed by the
 * guard (caller should then render the normal error state).
 */
export function reloadForChunkError(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_GUARD_KEY));
    if (last && Date.now() - last < RELOAD_GUARD_MS) {
      return false;
    }
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    // sessionStorage can throw (private mode, disabled storage). Fall through to
    // an unguarded reload — recovering the user matters more than loop safety in
    // that rare case.
  }

  window.location.reload();
  return true;
}
