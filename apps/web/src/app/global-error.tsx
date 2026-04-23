"use client";

/**
 * Next.js global-error boundary.
 *
 * Required workaround for the Next 15.5.14 turbopack RSC Client Manifest
 * bug (§W-STACK): under the bun pnpm-style `.bun` store, turbopack fails
 * to resolve `next/dist/client/components/builtin/global-error.js`, so
 * every HTML route 500s with "Could not find module global-error.js".
 * Having a user-level global-error.tsx in the app directory short-circuits
 * the builtin lookup and restores normal rendering.
 *
 * Pair with `rm -rf .next` before `next dev` (see apps/web/package.json
 * predev script) to purge stale manifest entries that can mask this file.
 *
 * When Next/turbopack ships a fix for the upstream bug, delete this file
 * + the predev script and verify `bun run dev` still renders.
 */
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div
          style={{
            fontFamily: "system-ui, sans-serif",
            padding: "2rem",
            maxWidth: "40rem",
            margin: "4rem auto",
          }}
        >
          <h2 style={{ margin: 0 }}>Something went wrong</h2>
          {error.digest ? (
            <p style={{ color: "#666", fontFamily: "monospace", fontSize: "0.85rem" }}>
              digest: {error.digest}
            </p>
          ) : null}
          <pre
            style={{
              background: "#f4f4f5",
              padding: "1rem",
              borderRadius: "6px",
              overflow: "auto",
              fontSize: "0.85rem",
            }}
          >
            {error.message}
          </pre>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: "0.5rem 1rem",
              background: "#111",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
