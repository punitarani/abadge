/**
 * Drives the real CLI binary through `org add --json`, asserting that the
 * created organization is emitted as parseable JSON with a string `id` so CI
 * scripts can create an org and capture its id in one step.
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

describe("cli org add --json", () => {
  test("emits the created org as JSON with a string id", async () => {
    const apiUrl = stack.apiUrl();
    const owner = await signupAndLogin(apiUrl);
    const home = freshHome();
    const env = { home, apiUrl, sessionToken: owner.sessionToken };

    const result = await runCli(
      ["org", "add", "--name", "JSON Flow", "--slug", `json-flow-${crypto.randomUUID()}`, "--json"],
      env,
    );

    expect(result.exitCode).toBe(0);
    const org = JSON.parse(result.stdout) as { id: string; name: string };
    expect(typeof org.id).toBe("string");
    expect(org.id.length).toBeGreaterThan(0);
    expect(org.name).toBe("JSON Flow");
  }, 90_000);
});
