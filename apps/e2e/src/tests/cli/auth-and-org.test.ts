/**
 * Drive the compiled `abadge` binary against the real wrangler-dev API.
 * Verifies the binary's HTTP path (SDK over fetch) end-to-end: signup happens
 * out-of-band over Better Auth HTTP, then the bearer token is passed via
 * ABADGE_SESSION_TOKEN and the binary creates and lists organizations.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
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

describe("cli auth + org", () => {
  test("org create + org list (table + json)", async () => {
    const apiUrl = stack.apiUrl();
    const owner = await signupAndLogin(apiUrl);
    const home = freshHome();

    const slug = `cli-org-${crypto.randomUUID()}`;
    const create = await runCli(["org", "create", "--name", "CLI E2E Org", "--slug", slug], {
      home,
      apiUrl,
      sessionToken: owner.sessionToken,
    });
    expect(create.exitCode).toBe(0);
    expect(create.stdout + create.stderr).toMatch(/Organization created/);

    const list = await runCli(["org", "list", "--json"], {
      home,
      apiUrl,
      sessionToken: owner.sessionToken,
    });
    expect(list.exitCode).toBe(0);
    const orgs = JSON.parse(list.stdout) as Array<{ slug: string; name: string }>;
    expect(orgs.some((o) => o.slug === slug)).toBe(true);
  }, 60_000);
});
