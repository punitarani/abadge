import { Command } from "commander";
import { createUserApiClient } from "../client";
import { loadConfig, requireActiveOrgId, requireConfig, updateConfig } from "../config";
import { daemonChangePassword, daemonLock, daemonStatus, daemonUnlock } from "../daemon";
import { error, errorMessage, json, success, table } from "../output";
import { prompt } from "../prompt";

export function createProfileCommand(): Command {
  const cmd = new Command("profile").description(
    "Manage encryption profiles and the daemon-held vault key",
  );

  cmd
    .command("add")
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
        const result = await client.profiles.create({
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
        const { profiles } = await client.profiles.list(orgId);

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
        const { profiles } = await client.profiles.list(orgId);
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

  cmd
    .command("unlock")
    .description(
      "Unlock the active zero-knowledge profile into daemon memory (prompts for password)",
    )
    .action(profileUnlock);
  cmd
    .command("lock")
    .description("Clear the unlocked profile key from daemon memory")
    .action(profileLock);
  cmd
    .command("status")
    .description("Show whether the daemon holds an unlocked profile key")
    .action(profileStatus);
  cmd
    .command("change-password")
    .description("Change the active zero-knowledge profile's master password")
    .action(profileChangePassword);

  return cmd;
}

function requireActiveProfile(): string {
  const config = requireConfig();
  if (!config.activeProfileId) {
    error("No active profile — run `abadge profile use <id|name>` first.");
    process.exit(1);
  }
  return config.activeProfileId;
}

async function profileUnlock(): Promise<void> {
  const profileId = requireActiveProfile();
  const password = await prompt("Master password: ", true);
  if (!password) {
    error("Password is required.");
    process.exit(1);
  }

  try {
    const res = await daemonUnlock(profileId, password);
    success(
      `Profile unlocked (key version ${res.keyVersion}). Auto-locks after 15 min of inactivity — re-run \`abadge profile unlock\` if it locks.`,
    );
  } catch (err) {
    error(errorMessage(err, "Failed to unlock profile."));
    process.exit(1);
  }
}

async function profileLock(): Promise<void> {
  try {
    await daemonLock();
    success("Profile locked.");
  } catch (err) {
    error(errorMessage(err, "Failed to lock profile."));
    process.exit(1);
  }
}

async function profileStatus(): Promise<void> {
  try {
    const status = await daemonStatus();
    console.log(`Profile: ${status.locked ? "locked" : "unlocked"}`);
    console.log(`Key version: ${status.keyVersion}`);
  } catch (err) {
    error(errorMessage(err, "Failed to get profile status."));
    process.exit(1);
  }
}

async function profileChangePassword(): Promise<void> {
  const profileId = requireActiveProfile();
  const oldPassword = await prompt("Current master password: ", true);
  const newPassword = await prompt("New master password: ", true);
  const confirm = await prompt("Confirm new master password: ", true);

  if (!oldPassword || !newPassword) {
    error("Both old and new passwords are required.");
    process.exit(1);
  }

  if (newPassword !== confirm) {
    error("New passwords do not match.");
    process.exit(1);
  }

  try {
    await daemonChangePassword(profileId, oldPassword, newPassword);
    success("Master password changed.");
  } catch (err) {
    error(errorMessage(err, "Failed to change password."));
    process.exit(1);
  }
}
