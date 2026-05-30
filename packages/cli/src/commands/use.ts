import { Command } from "commander";
import { createUserApiClient } from "../client";
import { loadConfig, requireActiveOrgId, updateConfig } from "../config";
import { daemonSetAuthOrg } from "../daemon";
import { error, errorMessage, success } from "../output";

/**
 * Top-level `abadge use` context switcher for org and profile — the canonical
 * entry point. Mirrors `abadge org use <id|slug>` and
 * `abadge profile use <id|name>`.
 */
export function createUseCommand(): Command {
  const cmd = new Command("use").description("Switch active organization or profile context");

  cmd
    .command("org")
    .description("Set the active organization")
    .argument("<id-or-slug>", "Organization ID or slug")
    .action(async (idOrSlug: string) => {
      try {
        const client = await createUserApiClient();
        const { organizations } = await client.orgs.list();
        const org = organizations.find((o) => o.id === idOrSlug || o.slug === idOrSlug);
        if (!org) {
          error(`Organization '${idOrSlug}' not found.`);
          process.exit(1);
        }
        updateConfig({ activeOrgId: org.id, activeProfileId: undefined });
        await daemonSetAuthOrg(org.id).catch(() => undefined);
        success(`Active organization set to ${org.name} (${org.id}).`);
      } catch (err) {
        error(errorMessage(err, "Failed to set active organization."));
        process.exit(1);
      }
    });

  cmd
    .command("profile")
    .description("Set the active profile in the current organization")
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

  // Allow no-arg invocation to print current context for convenience.
  cmd.action(() => {
    const config = loadConfig();
    if (!config) {
      console.log("No active context configured.");
      return;
    }
    console.log(`Active org:     ${config.activeOrgId ?? "(none)"}`);
    console.log(`Active profile: ${config.activeProfileId ?? "(none)"}`);
  });

  return cmd;
}
