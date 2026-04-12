import { z } from "zod";
import type { McpConfig } from "../config.js";
import { activeMounts, releaseMount } from "./mount-secret.js";

export const toolName = "release_mount";

export const toolDescription =
  "Release a mounted secret by mountId. Deletes the temp file immediately.";

export const toolInputSchema = z.object({
  mountId: z.string().describe("Opaque mount ID returned by mount_secret"),
});

export async function handler(
  input: z.infer<typeof toolInputSchema>,
  _config: McpConfig,
): Promise<string> {
  if (!activeMounts.has(input.mountId)) {
    throw new Error("No active mount found for this mountId");
  }

  releaseMount(input.mountId);

  return JSON.stringify({ released: true, mountId: input.mountId });
}
