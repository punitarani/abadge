/**
 * `permission create` must let a CLI user grant canonical `read`/`use` — which
 * the docs/CLI-help teach — via a profile target. Previously the command only
 * accepted `--item-id`, item grants reject canonical names, and the server's
 * "target a profile instead" remedy was impossible to follow from the CLI
 * (DX-001). Now `--profile-id` exists and canonical names work there.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { generateEd25519KeyPair } from "@abadge/crypto";
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

async function setup() {
  const apiUrl = stack.apiUrl();
  const owner = await signupAndLogin(apiUrl);
  const home = mkTmpDir("cli-home");
  tmpHomes.push(home);
  const seed = new AbadgeUserClient({ apiUrl, sessionToken: owner.sessionToken });
  const org = (await seed.orgs.create({
    name: "Cap Vocab",
    slug: `cap-${crypto.randomUUID()}`,
  })) as {
    id: string;
  };
  const scoped = new AbadgeUserClient({ apiUrl, sessionToken: owner.sessionToken, orgId: org.id });
  const profileId = (await scoped.profiles.list(org.id)).profiles[0]?.id as string;
  const item = await scoped.items.create({
    storageMode: "server_managed",
    payload: { v: 1, label: "k", kind: "opaque", tags: [], fields: { value: "x" } },
  });
  // A local_cli agent: mount_env (a local-injection capability) is matrix-legal
  // for it, unlike a remote agent which is restricted to reveal on server_managed.
  const { publicKey } = await generateEd25519KeyPair();
  const agent = await scoped.agents.create({ name: "a", kind: "local_cli", publicKey });
  const base = { home, apiUrl, sessionToken: owner.sessionToken, activeOrgId: org.id };
  return { base, profileId, itemId: item.id, agentId: agent.agent.id };
}

describe("cli permission create — item vs profile targets", () => {
  test("canonical `read` on a --profile-id target succeeds", async () => {
    const { base, profileId, agentId } = await setup();
    const res = await runCli(
      [
        "permission",
        "create",
        "--agent-id",
        agentId,
        "--profile-id",
        profileId,
        "--capability",
        "read",
      ],
      base,
    );
    expect(res.exitCode).toBe(0);
  });

  test("canonical `read` on a --item-id target fails with an actionable message naming --profile-id", async () => {
    const { base, itemId, agentId } = await setup();
    const res = await runCli(
      ["permission", "create", "--agent-id", agentId, "--item-id", itemId, "--capability", "read"],
      base,
    );
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("--profile-id");
  });

  test("legacy `mount_env` still works on a --item-id target", async () => {
    const { base, itemId, agentId } = await setup();
    const res = await runCli(
      [
        "permission",
        "create",
        "--agent-id",
        agentId,
        "--item-id",
        itemId,
        "--capability",
        "mount_env",
      ],
      base,
    );
    expect(res.exitCode).toBe(0);
  });

  test("requires exactly one of --item-id / --profile-id", async () => {
    const { base, agentId } = await setup();
    const res = await runCli(
      ["permission", "create", "--agent-id", agentId, "--capability", "read"],
      base,
    );
    expect(res.exitCode).toBe(1);
    expect(res.stderr.toLowerCase()).toContain("item-id");
  });
});
