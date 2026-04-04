import { Command } from "commander";
import { daemonChangePassword, daemonLock, daemonUnlock, daemonVaultStatus } from "../daemon";
import { error, success } from "../output";
import { prompt } from "../prompt";

export function createVaultCommand(): Command {
  const cmd = new Command("vault").description("Manage vault encryption");

  cmd.command("unlock").description("Unlock the vault").action(vaultUnlock);
  cmd.command("lock").description("Lock the vault").action(vaultLockCmd);
  cmd.command("status").description("Show vault status").action(vaultStatusCmd);
  cmd.command("change-password").description("Change master password").action(vaultChangePassword);

  return cmd;
}

async function vaultUnlock(): Promise<void> {
  const password = await prompt("Master password: ", true);
  if (!password) {
    error("Password is required.");
    process.exit(1);
  }

  const res = await daemonUnlock(password);
  if (!res.ok) {
    error(res.error ?? "Failed to unlock vault.");
    process.exit(1);
  }
  success("Vault unlocked.");
}

async function vaultLockCmd(): Promise<void> {
  const res = await daemonLock();
  if (!res.ok) {
    error(res.error ?? "Failed to lock vault.");
    process.exit(1);
  }
  success("Vault locked.");
}

async function vaultStatusCmd(): Promise<void> {
  const res = await daemonVaultStatus();
  if (!res.ok) {
    error(res.error ?? "Failed to get vault status.");
    process.exit(1);
  }
  const data = res.data as { locked?: boolean; keyVersion?: number } | undefined;
  console.log(`Vault: ${data?.locked === false ? "unlocked" : "locked"}`);
  if (data?.locked === false && data.keyVersion) {
    console.log(`Key version: ${data.keyVersion}`);
  }
}

async function vaultChangePassword(): Promise<void> {
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

  const res = await daemonChangePassword(oldPassword, newPassword);
  if (!res.ok) {
    error(res.error ?? "Failed to change password.");
    process.exit(1);
  }
  success("Master password changed.");
}
