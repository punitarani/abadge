import { describe, expect, it } from "bun:test";
import { getTrustedOrigins } from "./server";

describe("getTrustedOrigins", () => {
  it("includes ABADGE API and app URLs plus localhost origins", () => {
    const origins = getTrustedOrigins({
      ABADGE_API_URL: "https://api.abadge.io",
      ABADGE_APP_URL: "https://abadge.io",
    });
    expect(origins).toContain("https://api.abadge.io");
    expect(origins).toContain("https://abadge.io");
    expect(origins).toContain("http://localhost:3000");
    expect(origins).toContain("http://localhost:3001");
  });
});
