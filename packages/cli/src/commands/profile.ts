import type { Profile } from "@abadge/core";
import { Command } from "commander";
import { createUserApiClient } from "../client";
import { loadConfig, requireActiveOrgId, requireConfig, updateConfig } from "../config";
import { daemonChangePassword, daemonLock, daemonStatus, daemonUnlock } from "../daemon";
import { error, errorMessage, json, success, table, warn } from "../output";
import { computeBootstrapMaterial } from "../profile-bootstrap";
import { prompt } from "../prompt";

/**
 * Public-safe view of a profile for `--json` output. Drops the wrapped-key and
 * KDF columns (`wrappedRootKey`, `kdfSalt`, `kdfParams`, `recoveryWrappedRootKey`)
 * which carry encrypted key material and have no business in scripting output.
 */
export type ProfileJsonDto = Pick<
  Profile,
  | "id"
  | "name"
  | "externalId"
  | "description"
  | "storageMode"
  | "keyVersion"
  | "createdAt"
  | "updatedAt"
>;

// Accepts a full `Profile` row and projects it down to the safe DTO. Typing the
// input as `Profile` (not the already-stripped DTO) keeps the projection honest:
// a new sensitive field added to `Profile` is simply not picked here, by design.
export function toProfileJsonDto(profile: Profile): ProfileJsonDto {
  return {
    id: profile.id,
    name: profile.name,
    externalId: profile.externalId,
    description: profile.description,
    storageMode: profile.storageMode,
    keyVersion: profile.keyVersion,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

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
        if (opts.storageMode === "zero_knowledge") {
          console.log(
            "Next: run `abadge profile bootstrap` to set a master password before storing zero-knowledge items.",
          );
        }
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
          // The SDK return type under-declares profile fields; at runtime each
          // row is a full `Profile` (see ProfileSchema in @abadge/core).
          json((profiles as unknown as Profile[]).map(toProfileJsonDto));
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
    .command("bootstrap")
    .description(
      "Initialize a zero-knowledge profile with a master password (required before storing ZK items)",
    )
    .argument("[name-or-id]", "Profile name or ID (defaults to the active profile)")
    .action(profileBootstrap);
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

/**
 * Read a master password. On a TTY: prompt twice (no echo) and confirm. When
 * stdin is piped (CI): read it to EOF as the password, stripping one trailing
 * newline. The password never derives a key on the server — it stays local.
 */
async function readMasterPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    return await new Promise<string>((resolve, reject) => {
      let data = "";
      process.stdin.setEncoding("utf-8");
      process.stdin.on("data", (chunk: string) => {
        data += chunk;
      });
      // A master password is single-line; strip ALL trailing newlines so a stray
      // `printf "pw\n\n"` doesn't silently embed a newline and lock the user out.
      process.stdin.on("end", () => resolve(data.replace(/[\r\n]+$/, "")));
      process.stdin.on("error", reject);
      process.stdin.resume();
    });
  }
  const pw = await prompt("New master password: ", true);
  const confirm = await prompt("Confirm master password: ", true);
  if (pw !== confirm) {
    error("Passwords do not match.");
    process.exit(1);
  }
  return pw;
}

async function profileBootstrap(nameOrId?: string): Promise<void> {
  const orgId = requireActiveOrgId();
  const client = await createUserApiClient();
  const { profiles } = await client.profiles.list(orgId);
  const activeProfileId = loadConfig()?.activeProfileId;
  const target = nameOrId
    ? profiles.find((p) => p.id === nameOrId || p.name === nameOrId)
    : profiles.find((p) => p.id === activeProfileId);

  if (!target) {
    error(
      nameOrId
        ? `Profile '${nameOrId}' not found in this organization.`
        : "No active profile — pass a profile name/id, or run `abadge profile use <id|name>` first.",
    );
    process.exit(1);
  }
  if (target.storageMode !== "zero_knowledge") {
    error(
      `Profile '${target.name}' is ${target.storageMode}. Only zero-knowledge profiles need bootstrapping — server-managed profiles are ready to use immediately.`,
    );
    process.exit(1);
  }
  // The list row carries `wrappedRootKey` at runtime even though the SDK type
  // omits it; a non-null value means the profile was already bootstrapped.
  const alreadyBootstrapped = Boolean(
    (target as { wrappedRootKey?: string | null }).wrappedRootKey,
  );
  if (alreadyBootstrapped) {
    error(
      `Profile '${target.name}' is already bootstrapped. Run \`abadge profile unlock\` to use it, or \`abadge profile change-password\` to change its password.`,
    );
    process.exit(1);
  }

  const password = await readMasterPassword();
  if (password.length < 8) {
    error("Master password must be at least 8 characters.");
    process.exit(1);
  }

  const material = computeBootstrapMaterial(target.id, password);
  try {
    await client.bootstrapProfile(target.id, {
      wrappedRootKey: material.wrappedRootKey,
      kdfSalt: material.kdfSalt,
      kdfParams: material.kdfParams,
    });
  } catch (err) {
    error(errorMessage(err, "Failed to bootstrap profile."));
    process.exit(1);
  }

  // The password wrap is now committed: the profile is usable via `profile
  // unlock`, and re-running bootstrap will report "already bootstrapped". Set up
  // recovery as a separate step so a failure there doesn't leave the user with a
  // bootstrapped-but-stuck profile and a silently-discarded recovery key.
  let recoveryConfigured = true;
  try {
    await client.setupProfileRecovery(target.id, {
      recoveryWrappedRootKey: material.recoveryWrappedRootKey,
    });
  } catch {
    recoveryConfigured = false;
  }

  success(`Profile '${target.name}' bootstrapped.`);
  if (recoveryConfigured) {
    console.log("");
    console.log("=== RECOVERY KEY — save this now, it will not be shown again ===");
    console.log(`  ${material.recoveryKey}`);
    console.log("===============================================================");
    console.log("");
    console.log("Next: run `abadge profile unlock` to use this profile for zero-knowledge items.");
  } else {
    warn(
      "The profile is bootstrapped and usable via your master password (`abadge profile unlock`), but recovery-key setup did NOT complete — there is no recovery key for this profile, and the CLI can't configure recovery standalone yet. Keep your master password safe; recreate the profile if you need a recovery key.",
    );
  }
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
