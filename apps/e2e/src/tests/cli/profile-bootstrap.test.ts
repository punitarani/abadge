/**
 * `abadge profile bootstrap` initializes a zero-knowledge profile from the CLI —
 * previously impossible (the CLI could create a ZK profile but never bootstrap
 * it, so ZK mode was unusable from the CLI). DX-S2-G.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { AbadgeUserClient } from "@abadge/sdk";
import { signupAndLogin } from "../../harness/auth";
import { runCli } from "../../harness/cli";
import { mkTmpDir } from "../../harness/env";
import { useTestStack } from "../../harness/test-stack";

const stack = useTestStack();
const tmpHomes: string[] = [];
afterEach(() => {
  for (const h of tmpHomes.splice(0)) rmSync(h, { recursive: true, force: true });
});

describe("cli profile bootstrap", () => {
  test("bootstraps a zero-knowledge profile, then rejects a second bootstrap", async () => {
    const apiUrl = stack.apiUrl();
    const owner = await signupAndLogin(apiUrl);
    const home = mkTmpDir("cli-home");
    tmpHomes.push(home);

    const seed = new AbadgeUserClient({ apiUrl, sessionToken: owner.sessionToken });
    const org = (await seed.orgs.create({ name: "ZK Org", slug: `zk-${crypto.randomUUID()}` })) as {
      id: string;
    };
    const scoped = new AbadgeUserClient({
      apiUrl,
      sessionToken: owner.sessionToken,
      orgId: org.id,
    });
    const zk = await scoped.profiles.create({
      orgId: org.id,
      name: "secrets",
      storageMode: "zero_knowledge",
    });

    const base = { home, apiUrl, sessionToken: owner.sessionToken, activeOrgId: org.id };

    // Bootstrap via the CLI with the master password piped on stdin.
    const res = await runCli(["profile", "bootstrap", zk.id], {
      ...base,
      stdin: "a-strong-master-password",
    });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("RECOVERY KEY");
    expect(res.stdout).toContain("bootstrapped");

    // The profile row now carries a wrapped root key (runtime field).
    const after = (await scoped.profiles.list(org.id)).profiles.find((p) => p.id === zk.id) as {
      wrappedRootKey?: string | null;
    };
    expect(after.wrappedRootKey).toBeTruthy();

    // A second bootstrap must be rejected, not silently re-key the profile.
    const again = await runCli(["profile", "bootstrap", zk.id], {
      ...base,
      stdin: "another-password",
    });
    expect(again.exitCode).toBe(1);
    expect(again.stderr).toContain("already bootstrapped");
  });

  test("refuses to bootstrap a server-managed profile", async () => {
    const apiUrl = stack.apiUrl();
    const owner = await signupAndLogin(apiUrl);
    const home = mkTmpDir("cli-home");
    tmpHomes.push(home);
    const seed = new AbadgeUserClient({ apiUrl, sessionToken: owner.sessionToken });
    const org = (await seed.orgs.create({ name: "SM Org", slug: `sm-${crypto.randomUUID()}` })) as {
      id: string;
    };
    const scoped = new AbadgeUserClient({
      apiUrl,
      sessionToken: owner.sessionToken,
      orgId: org.id,
    });
    const def = (await scoped.profiles.list(org.id)).profiles[0] as { id: string };

    const res = await runCli(["profile", "bootstrap", def.id], {
      home,
      apiUrl,
      sessionToken: owner.sessionToken,
      activeOrgId: org.id,
      stdin: "whatever-password",
    });
    expect(res.exitCode).toBe(1);
    expect(res.stderr.toLowerCase()).toContain("server-managed");
  });
});
