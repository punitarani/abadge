/**
 * `item update` must be drivable non-interactively. Previously it prompted for
 * Label/Kind via readline (which buffers ALL piped stdin), so a piped value was
 * consumed by the Label prompt and the value read came back empty — `item
 * update` could not be scripted. With `--label`/`--kind`/`--value` flags the
 * prompts are bypassed and the piped bytes flow only to the value reader.
 * (Greptile follow-up from PR #230.)
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

describe("cli item update — scriptable via flags + piped stdin", () => {
  test("`printf %s new | item update <id> --label L --kind api_key` replaces the value non-interactively", async () => {
    const apiUrl = stack.apiUrl();
    const owner = await signupAndLogin(apiUrl);
    const home = mkTmpDir("cli-home");
    tmpHomes.push(home);

    const seed = new AbadgeUserClient({ apiUrl, sessionToken: owner.sessionToken });
    const org = await seed.orgs.create({ name: "Update Flow", slug: `upd-${crypto.randomUUID()}` });
    const scoped = new AbadgeUserClient({
      apiUrl,
      sessionToken: owner.sessionToken,
      orgId: org.id,
    });

    // Seed a server_managed item with an initial value.
    const created = await scoped.items.create({
      storageMode: "server_managed",
      payload: { v: 1, label: "demo", kind: "api_key", tags: [], fields: { value: "old-value" } },
    });

    const NEW_SECRET = "new-secret-no-newline"; // no trailing newline, like `echo -n`
    const res = await runCli(
      ["item", "update", created.id, "--label", "demo", "--kind", "api_key", "--json"],
      {
        home,
        apiUrl,
        sessionToken: owner.sessionToken,
        activeOrgId: org.id,
        stdin: NEW_SECRET,
      },
    );

    expect(res.exitCode).toBe(0);
    // stdout must be clean JSON — no "Value (secret):" / "Label:" prompt chrome.
    const parsed = JSON.parse(res.stdout) as { contentVersion?: number };
    expect(typeof parsed.contentVersion).toBe("number");

    // The stored value must now be exactly the piped secret.
    const revealed = (await scoped.ownerReveal(created.id)) as {
      payload: { fields: { value: string } };
    };
    expect(revealed.payload.fields.value).toBe(NEW_SECRET);
  });

  test("fully non-interactive via --value (no TTY) also works", async () => {
    const apiUrl = stack.apiUrl();
    const owner = await signupAndLogin(apiUrl);
    const home = mkTmpDir("cli-home");
    tmpHomes.push(home);

    const seed = new AbadgeUserClient({ apiUrl, sessionToken: owner.sessionToken });
    const org = await seed.orgs.create({
      name: "Update Flag",
      slug: `updf-${crypto.randomUUID()}`,
    });
    const scoped = new AbadgeUserClient({
      apiUrl,
      sessionToken: owner.sessionToken,
      orgId: org.id,
    });
    const created = await scoped.items.create({
      storageMode: "server_managed",
      payload: { v: 1, label: "demo", kind: "opaque", tags: [], fields: { value: "old" } },
    });

    const res = await runCli(
      [
        "item",
        "update",
        created.id,
        "--label",
        "demo",
        "--kind",
        "opaque",
        "--value",
        "flag-value",
      ],
      { home, apiUrl, sessionToken: owner.sessionToken, activeOrgId: org.id },
    );

    expect(res.exitCode).toBe(0);
    const revealed = (await scoped.ownerReveal(created.id)) as {
      payload: { fields: { value: string } };
    };
    expect(revealed.payload.fields.value).toBe("flag-value");
  });
});
