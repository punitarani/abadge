import { describe, expect, test } from "bun:test";
import { workspacePosture } from "./workspace-posture";

describe("workspacePosture", () => {
  test("personal accounts are framed as the user's own vault, never custody", () => {
    const p = workspacePosture(true);
    expect(p.banner).toContain("Your personal vault");
    expect(p.banner.toLowerCase()).not.toContain("custody");
    expect(p.banner.toLowerCase()).not.toContain("on behalf");
    // Personal accounts can reveal their own values.
    expect(p.banner.toLowerCase()).toContain("reveal your own");
    expect(p.profilesCardLabel).toBe("Profiles");
    expect(p.profilesSubtitle.toLowerCase()).not.toContain("per user or entity");
    expect(p.accountNoun).toBe("Account");
    expect(p.accountNounLower).toBe("personal account");
  });

  test("team organizations stay in custody mode", () => {
    const c = workspacePosture(false);
    expect(c.banner).toContain("Custody mode active");
    expect(c.banner).toContain("on behalf of your users");
    expect(c.profilesCardLabel).toBe("Profiles under custody");
    expect(c.profilesSubtitle).toContain("one per user or entity");
    expect(c.accountNoun).toBe("Organization");
    expect(c.accountNounLower).toBe("organization");
  });
});
