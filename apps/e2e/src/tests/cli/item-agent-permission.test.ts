/**
 * CLI binary covers the item / agent / permission triad for a server-managed
 * item end-to-end. Mirrors §3.1–§3.6 of TESTING.md Phase 4 in TypeScript so
 * it runs in CI instead of the manual bash harness.
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
  for (const h of tmpHomes.splice(0)) {
    rmSync(h, { recursive: true, force: true });
  }
});

function freshHome(): string {
  const h = mkTmpDir("cli-home");
  tmpHomes.push(h);
  return h;
}

describe("cli item + agent + permission flow", () => {
  test("permission create accepts repeated --capability and yields the right rows", async () => {
    const apiUrl = stack.apiUrl();
    const owner = await signupAndLogin(apiUrl);
    const home = freshHome();
    const env = { home, apiUrl, sessionToken: owner.sessionToken };

    // SDK-backed setup: org + profile + item + agent. Faster than driving
    // each through the CLI; the CLI is what we actually want to assert on.
    const seedClient = new AbadgeUserClient({ apiUrl, sessionToken: owner.sessionToken });
    const org = await seedClient.createOrganization({
      name: "CLI Flow",
      slug: `cli-flow-${crypto.randomUUID()}`,
    });
    const scoped = new AbadgeUserClient({
      apiUrl,
      sessionToken: owner.sessionToken,
      orgId: org.id,
    });
    // §REVAMP-PR3 Task 5.1 — default server_managed profile is auto-seeded.
    const item = await scoped.createItem({
      storageMode: "server_managed",
      payload: {
        v: 1,
        label: "cli-secret",
        kind: "opaque",
        tags: [],
        fields: { value: "sk-cli-test" },
      },
    });
    const agent = await scoped.createAgent({
      name: "cli-perm-agent",
      kind: "local_cli",
      authMethod: "legacy_api_key",
    });

    const homeWithOrg = freshHome();
    const envWithOrg = { ...env, home: homeWithOrg, activeOrgId: org.id };

    // Repeated --capability via the binary
    const create = await runCli(
      [
        "permission",
        "create",
        "--agent-id",
        agent.agent.id,
        "--item-id",
        item.id,
        "--capability",
        "mount_env",
        "--capability",
        "mount_file",
      ],
      envWithOrg,
    );
    expect(create.exitCode).toBe(0);
    expect(create.stdout + create.stderr).toMatch(/Granted 2 permissions/);

    const list = await runCli(
      ["permission", "list", "--agent-id", agent.agent.id, "--json"],
      envWithOrg,
    );
    expect(list.exitCode).toBe(0);
    const rows = JSON.parse(list.stdout) as Array<{ capability: string }>;
    expect(rows.map((r) => r.capability).sort()).toEqual(["mount_env", "mount_file"]);

    // Re-grant — surfaces PERMISSION_ALREADY_EXISTS as a non-zero exit
    const dup = await runCli(
      [
        "permission",
        "create",
        "--agent-id",
        agent.agent.id,
        "--item-id",
        item.id,
        "--capability",
        "mount_env",
      ],
      envWithOrg,
    );
    expect(dup.exitCode).not.toBe(0);
    expect(dup.stdout + dup.stderr).toMatch(/PERMISSION_ALREADY_EXISTS|already exist/i);

    // Comma-separated form — schema rejects in-input duplicates client-side
    const dupInInput = await runCli(
      [
        "permission",
        "create",
        "--agent-id",
        agent.agent.id,
        "--item-id",
        item.id,
        "--capability",
        "mount_env,mount_env",
      ],
      envWithOrg,
    );
    expect(dupInInput.exitCode).not.toBe(0);
    expect(dupInInput.stdout + dupInInput.stderr).toMatch(/Duplicate/i);
  }, 90_000);
});
