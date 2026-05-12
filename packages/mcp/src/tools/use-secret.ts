import { validateEnvVarName } from "@abadge/core";
import { z } from "zod";
import type { McpConfig } from "../config.js";
import * as runWithAllSecrets from "./run-with-all-secrets.js";
import * as runWithSecret from "./run-with-secret.js";

export const toolName = "use_secret";

export const toolDescription =
  "Run a command with a secret (or every env-var-shaped secret in a profile) injected as environment variables. Provide exactly one of `itemId`, `profileLabel`, or `profileExternalId`. Returns only the exit code, duration, output-line count, and a truncation flag. Subprocess stdout/stderr text is NEVER returned to the model — use mount_secret + a separate audited channel if output inspection is required.";

/**
 * Discriminated input: exactly one of itemId / profileLabel / profileExternalId.
 * MCP tool registration consumes `.shape`, so we keep the base ZodObject as
 * the exported schema and enforce the "exactly one of" constraint in the
 * handler body. This keeps the JSON-schema surface flat for the LLM while
 * still rejecting bad combinations at runtime.
 */
export const toolInputSchema = z.object({
  itemId: z
    .string()
    .optional()
    .describe("Run with a single item by id. Mutually exclusive with profile* fields."),
  profileLabel: z
    .string()
    .optional()
    .describe("Run with every env-shaped item in this profile (by id). Trust boundary."),
  profileExternalId: z
    .string()
    .optional()
    .describe("Run with every env-shaped item in this profile (by externalId). Trust boundary."),
  command: z.string().describe("Command to run"),
  args: z.array(z.string()).optional().describe("Command arguments"),
  envVarName: z
    .string()
    .optional()
    .describe(
      "Env var name for single-item injection (defaults to ABADGE_SECRET). Ignored in profile mode.",
    ),
  field: z
    .string()
    .optional()
    .describe("Named field to inject from a multi-field item payload. Ignored in profile mode."),
  purpose: z.string().optional().describe("Why this credential is needed"),
});

export async function handler(
  input: z.infer<typeof toolInputSchema>,
  config: McpConfig,
): Promise<string> {
  const targetCount =
    (input.itemId ? 1 : 0) + (input.profileLabel ? 1 : 0) + (input.profileExternalId ? 1 : 0);
  if (targetCount !== 1) {
    throw new Error(
      "Provide exactly one of itemId, profileLabel, or profileExternalId. They are mutually exclusive.",
    );
  }

  if (input.envVarName) {
    // Validate up front so we can error out before any subprocess work, with
    // the same message run_with_secret produced.
    const v = validateEnvVarName(input.envVarName);
    if (!v.ok) {
      if (v.reason === "reserved") {
        throw new Error(`Refusing to inject secret into reserved env var: ${input.envVarName}`);
      }
      throw new Error(
        `Invalid env var name: ${input.envVarName}. Must match /^[A-Z_][A-Z0-9_]*$/.`,
      );
    }
  }

  if (input.itemId) {
    return runWithSecret.handler(
      {
        itemId: input.itemId,
        field: input.field,
        command: input.command,
        args: input.args,
        envVarName: input.envVarName,
        purpose: input.purpose,
      },
      config,
    );
  }

  // Profile mode: profileLabel and profileExternalId both resolve to a profile
  // identifier the bulk endpoint accepts. The current SDK + REST surface keys
  // on profileId; treat profileLabel as a profileId for now (callers passing
  // an externalId will get a clear server-side error). When the access.use*
  // surface lands (PR 2/3 follow-up), the externalId branch will route through
  // /v1/access/use-profile-by-external-id.
  const profileId = input.profileLabel ?? input.profileExternalId;
  if (!profileId) {
    throw new Error("Internal: profile mode reached without a profile identifier.");
  }
  return runWithAllSecrets.handler(
    {
      profileId,
      command: input.command,
      args: input.args,
      purpose: input.purpose,
    },
    config,
  );
}
