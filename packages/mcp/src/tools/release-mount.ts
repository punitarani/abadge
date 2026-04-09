import { tmpdir } from "node:os";
import { dirname, basename as pathBasename, sep } from "node:path";
import { z } from "zod";
import type { McpConfig } from "../config.js";
import { activeMounts, releaseMount } from "./mount-secret.js";

export const toolName = "release_mount";

export const toolDescription =
  "Release a previously mounted secret file, removing it and its temporary directory immediately.";

export const toolInputSchema = z.object({
  path: z.string().describe("File path returned by mount_secret"),
});

export async function handler(
  input: z.infer<typeof toolInputSchema>,
  _config: McpConfig,
): Promise<string> {
  const tmp = tmpdir();
  const tmpRoot = tmp.endsWith(sep) ? tmp : `${tmp}${sep}`;
  const parentDir = dirname(input.path);
  const parentName = pathBasename(parentDir);

  if (!parentDir.startsWith(tmpRoot) || !parentName.startsWith("abadge-")) {
    throw new Error(
      "Invalid mount path: must be under the system temp directory in an abadge-* folder",
    );
  }

  if (!activeMounts.has(input.path)) {
    throw new Error("No active mount found for this path");
  }

  releaseMount(input.path);

  return JSON.stringify({ released: true, path: input.path });
}
