import { describe, expect, it } from "bun:test";
import { getTrustedOrigins } from "./server";

describe("getTrustedOrigins", () => {
  it("includes API and APP URLs plus localhost origins", () => {
    const origins = getTrustedOrigins({
      API_URL: "https://api.abadge.io",
      APP_URL: "https://abadge.io",
    });
    expect(origins).toContain("https://api.abadge.io");
    expect(origins).toContain("https://abadge.io");
    expect(origins).toContain("http://localhost:3000");
    expect(origins).toContain("http://localhost:3001");
  });
});
