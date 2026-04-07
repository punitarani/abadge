import { describe, expect, test } from "bun:test";
import nextConfig from "./next.config";

describe("next redirects", () => {
  test("/install redirects to the raw GitHub installer", async () => {
    const redirects = await nextConfig.redirects?.();

    expect(redirects).toContainEqual({
      source: "/install",
      destination: "https://raw.githubusercontent.com/punitarani/abadge/main/install.sh",
      permanent: false,
    });
  });
});
