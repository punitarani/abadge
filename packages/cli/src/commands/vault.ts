import { Command } from "commander";
import { requireConfig } from "../config";
import { daemonChangePassword, daemonLock, daemonStatus, daemonUnlock } from "../daemon";
import { error, errorMessage, success } from "../output";
import { prompt } from "../prompt";

export function createVaultCommand(): Command {
  const cmd = new Command("vault").description("Manage profile encryption");

  cmd.command("unlock").description("Unlock the active profile").action(vaultUnlock);
  cmd.command("lock").description("Lock the vault (all unlocked profiles)").action(vaultLockCmd);
  cmd.command("status").description("Show vault status").action(vaultStatusCmd);
  cmd
    .command("change-password")
    .description("Change active profile's master password")
    .action(vaultChangePassword);

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

async function vaultUnlock(): Promise<void> {
  const profileId = requireActiveProfile();
  const password = await prompt("Master password: ", true);
  if (!password) {
    error("Password is required.");
    process.exit(1);
  }

  try {
    const res = await daemonUnlock(profileId, password);
    success(`Profile unlocked (key version ${res.keyVersion}).`);
  } catch (err) {
    error(errorMessage(err, "Failed to unlock profile."));
    process.exit(1);
  }
}

async function vaultLockCmd(): Promise<void> {
  try {
    await daemonLock();
    success("Vault locked.");
  } catch (err) {
    error(errorMessage(err, "Failed to lock vault."));
    process.exit(1);
  }
}

async function vaultStatusCmd(): Promise<void> {
  try {
    const status = await daemonStatus();
    console.log(`Vault: ${status.locked ? "locked" : "unlocked"}`);
    console.log(`Key version: ${status.keyVersion}`);
  } catch (err) {
    error(errorMessage(err, "Failed to get vault status."));
    process.exit(1);
  }
}

async function vaultChangePassword(): Promise<void> {
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
