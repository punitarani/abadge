import { Command } from "commander";
import { createUserApiClient } from "../client";
import { loadConfig, requireActiveOrgId, updateConfig } from "../config";
import { error, errorMessage, json, success, table } from "../output";

export function createProfileCommand(): Command {
  const cmd = new Command("profile").description("Manage credential profiles");

  cmd
    .command("create")
    .description("Create a new profile in the active organization")
    .requiredOption("--name <name>", "Profile name")
    .option("--description <desc>", "Profile description")
    .option(
      "--storage-mode <mode>",
      "Default storage mode: zero_knowledge or server_managed",
      "server_managed",
    )
    .action(async (opts: { name: string; description?: string; storageMode?: string }) => {
      try {
        const orgId = requireActiveOrgId();
        const client = await createUserApiClient();
        const result = await client.createProfile({
          orgId,
          name: opts.name,
          description: opts.description,
          storageMode: opts.storageMode,
        });
        success(`Profile created: ${opts.name} (${result.id})`);
      } catch (err) {
        error(errorMessage(err, "Failed to create profile."));
        process.exit(1);
      }
    });

  cmd
    .command("list")
    .description("List profiles in the active organization")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      try {
        const orgId = requireActiveOrgId();
        const client = await createUserApiClient();
        const { profiles } = await client.listProfiles(orgId);

        if (opts.json) {
          json(profiles);
          return;
        }

        const config = loadConfig();
        table(
          profiles.map((p) => ({
            ID: p.id,
            Name: p.name,
            "Storage Mode": p.storageMode,
            Created: p.createdAt,
            Active: p.id === config?.activeProfileId ? "✓" : "",
          })),
        );
      } catch (err) {
        error(errorMessage(err, "Failed to list profiles."));
        process.exit(1);
      }
    });

  cmd
    .command("use")
    .description("Set the active profile")
    .argument("<name-or-id>", "Profile name or ID")
    .action(async (nameOrId: string) => {
      try {
        const orgId = requireActiveOrgId();
        const client = await createUserApiClient();
        const { profiles } = await client.listProfiles(orgId);
        const profile = profiles.find((p) => p.id === nameOrId || p.name === nameOrId);
        if (!profile) {
          error(`Profile '${nameOrId}' not found.`);
          process.exit(1);
        }
        updateConfig({ activeProfileId: profile.id });
        success(`Active profile set to ${profile.name ?? profile.id}.`);
      } catch (err) {
        error(errorMessage(err, "Failed to set active profile."));
        process.exit(1);
      }
    });

  return cmd;
}
