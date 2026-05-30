/**
 * Regression for the flagship quickstart pattern `echo -n 'secret' | abadge item
 * add --json`. The masked value prompt only resolved on a newline, so piping a
 * value WITHOUT a trailing newline (what `echo -n` produces, used to avoid
 * contaminating the stored secret) made `item add` hang then exit 0 having
 * stored nothing — and the prompt label "Value (secret): " leaked onto stdout,
 * corrupting `--json`.
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

describe("cli item add — piped stdin value", () => {
  test("`printf %s secret | item add --json` stores the exact value and emits clean JSON", async () => {
    const apiUrl = stack.apiUrl();
    const owner = await signupAndLogin(apiUrl);
    const home = mkTmpDir("cli-home");
    tmpHomes.push(home);

    const seed = new AbadgeUserClient({ apiUrl, sessionToken: owner.sessionToken });
    const org = await seed.orgs.create({
      name: "Stdin Flow",
      slug: `stdin-${crypto.randomUUID()}`,
    });

    const SECRET = "super-secret-no-newline"; // no trailing newline, like `echo -n`
    const res = await runCli(["item", "add", "--label", "piped", "--kind", "api_key", "--json"], {
      home,
      apiUrl,
      sessionToken: owner.sessionToken,
      activeOrgId: org.id,
      stdin: SECRET,
    });

    expect(res.exitCode).toBe(0);
    // stdout must be clean JSON — no "Value (secret):" prompt chrome.
    const parsed = JSON.parse(res.stdout) as { id?: string };
    expect(typeof parsed.id).toBe("string");

    // The stored value must be exactly what was piped (no trailing newline, no truncation).
    const scoped = new AbadgeUserClient({
      apiUrl,
      sessionToken: owner.sessionToken,
      orgId: org.id,
    });
    const revealed = (await scoped.ownerReveal(parsed.id as string)) as {
      payload: { fields: { value: string } };
    };
    expect(revealed.payload.fields.value).toBe(SECRET);
  });
});
