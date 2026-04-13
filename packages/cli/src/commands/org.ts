import { Command } from "commander";
import { createUserApiClient } from "../client";
import { loadConfig, requireActiveOrgId, updateConfig } from "../config";
import { error, errorMessage, json, success, table } from "../output";

export function createOrgCommand(): Command {
  const cmd = new Command("org").description("Manage organizations");

  cmd
    .command("create")
    .description("Create a new organization")
    .requiredOption("--name <name>", "Organization name")
    .option("--slug <slug>", "Organization slug (auto-generated if omitted)")
    .action(async (opts: { name: string; slug?: string }) => {
      try {
        const client = await createUserApiClient();
        const org = await client.createOrganization({ name: opts.name, slug: opts.slug });
        success(`Organization created: ${org.name} (${org.id})`);
      } catch (err) {
        error(errorMessage(err, "Failed to create organization."));
        process.exit(1);
      }
    });

  cmd
    .command("list")
    .description("List organizations you belong to")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      try {
        const client = await createUserApiClient();
        const { organizations } = await client.listOrganizations();

        if (opts.json) {
          json(organizations);
          return;
        }

        const config = loadConfig();
        table(
          organizations.map((org) => ({
            ID: org.id,
            Name: org.name,
            Slug: org.slug,
            Role: org.role,
            Active: org.id === config?.activeOrgId ? "✓" : "",
          })),
        );
      } catch (err) {
        error(errorMessage(err, "Failed to list organizations."));
        process.exit(1);
      }
    });

  cmd
    .command("use")
    .description("Set the active organization")
    .argument("<id-or-slug>", "Organization ID or slug")
    .action(async (idOrSlug: string) => {
      try {
        const client = await createUserApiClient();
        const { organizations } = await client.listOrganizations();
        const org = organizations.find((o) => o.id === idOrSlug || o.slug === idOrSlug);
        if (!org) {
          error(`Organization '${idOrSlug}' not found.`);
          process.exit(1);
        }
        updateConfig({ activeOrgId: org.id, activeProfileId: undefined });
        success(`Active organization set to ${org.name} (${org.id}).`);
      } catch (err) {
        error(errorMessage(err, "Failed to set active organization."));
        process.exit(1);
      }
    });

  cmd
    .command("members")
    .description("List members of the active organization")
    .action(async () => {
      try {
        const orgId = requireActiveOrgId();
        const client = await createUserApiClient();
        const { members } = await client.listMembers(orgId);
        table(
          members.map((m) => ({
            User: m.name || m.email || m.userId,
            Role: m.role,
          })),
        );
      } catch (err) {
        error(errorMessage(err, "Failed to list members."));
        process.exit(1);
      }
    });

  return cmd;
}
