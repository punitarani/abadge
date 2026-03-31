import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { type AccessResult, ApiClient } from "../client";
import { requireConfig } from "../config";
import { error, errorMessage, str, success, warn } from "../output";

export async function mountCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      secret: { type: "string" },
      path: { type: "string" },
      background: { type: "boolean", default: false },
    },
    strict: false,
  });

  const secretName = str(values.secret);
  const pathFlag = str(values.path);

  if (!secretName) {
    error("--secret is required.");
    process.exit(1);
  }

  const config = requireConfig();
  const client = new ApiClient(config);

  let secretValue: string;
  try {
    const result = await client.post<AccessResult>("/v1/credentials/access", {
      credentialName: secretName,
      deliveryMode: "file_mount",
    });
    if (!result.value) {
      throw new Error("No secret value returned");
    }
    secretValue = result.value;
  } catch (err) {
    error(errorMessage(err, "Failed to access secret."));
    process.exit(1);
  }

  const filePath = pathFlag ?? join(mkdtempSync(join(tmpdir(), "abadge-")), secretName);

  writeFileSync(filePath, secretValue, { mode: 0o600 });
  success(`Secret mounted at: ${filePath}`);

  const cleanup = (): void => {
    try {
      rmSync(filePath);
      success("Secret file removed.");
    } catch {
      warn(`Failed to remove ${filePath}. Please delete it manually.`);
    }
  };

  if (values.background) {
    warn("Running in background. Press Ctrl+C to unmount and exit.");
    process.on("SIGINT", () => {
      cleanup();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      cleanup();
      process.exit(0);
    });
    // Keep process alive
    setInterval(() => {}, 1 << 30);
  } else {
    const rl = createInterface({ input: stdin, output: stdout });
    await rl.question("Press Enter to unmount and delete the secret file...");
    rl.close();
    cleanup();
  }
}
