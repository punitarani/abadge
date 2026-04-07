import { OPERATOR_TOKEN_SCOPES, type OperatorTokenScope } from "@abadge/core";
import { Command } from "commander";
import { createSessionApiClient } from "../client";
import { error, errorMessage, json, success, table, warn } from "../output";

function collectScope(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function parseScopes(values: string[] | undefined): OperatorTokenScope[] {
  const scopes = values ?? [];
  const invalid = scopes.find(
    (scope) => !OPERATOR_TOKEN_SCOPES.includes(scope as OperatorTokenScope),
  );
  if (invalid) {
    error(`--scope must be one of: ${OPERATOR_TOKEN_SCOPES.join(", ")}`);
    process.exit(1);
  }

  return [...new Set(scopes as OperatorTokenScope[])];
}

export function createTokenCommand(): Command {
  const cmd = new Command("token").description("Manage operator automation tokens");

  cmd
    .command("create")
    .description("Create an operator automation token")
    .requiredOption("-n, --name <name>", "Token name")
    .option("--scope <scope>", "Token scope; repeat for multiple scopes", collectScope)
    .option("--expires-at <timestamp>", "Optional ISO timestamp expiry; max 30 days")
    .option("--json", "Output as JSON")
    .action(
      async (opts: { name: string; scope?: string[]; expiresAt?: string; json?: boolean }) => {
        const scopes = parseScopes(opts.scope);
        if (scopes.length === 0) {
          error(`At least one --scope is required. Choices: ${OPERATOR_TOKEN_SCOPES.join(", ")}`);
          process.exit(1);
        }

        try {
          const client = await createSessionApiClient();
          const result = await client.createOperatorToken({
            name: opts.name,
            scopes,
            expiresAt: opts.expiresAt,
          });

          if (opts.json) {
            json(result);
            return;
          }

          success(`Operator token "${result.operatorToken.name}" created.`);
          console.log("");
          warn("Save this token securely. It will NOT be shown again:");
          console.log(`  ${result.token}`);
        } catch (err) {
          error(errorMessage(err, "Failed to create operator token."));
          process.exit(1);
        }
      },
    );

  cmd
    .command("list")
    .description("List operator automation tokens")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      try {
        const client = await createSessionApiClient();
        const result = await client.listOperatorTokens();
        if (opts.json) {
          json(result.operatorTokens);
          return;
        }

        table(
          result.operatorTokens.map((token) => ({
            ID: token.id,
            Name: token.name,
            Prefix: token.tokenPrefix,
            Scopes: token.scopes.join(","),
            Expires: token.expiresAt,
            Revoked: token.revokedAt ?? "-",
          })),
        );
      } catch (err) {
        error(errorMessage(err, "Failed to list operator tokens."));
        process.exit(1);
      }
    });

  cmd
    .command("revoke")
    .description("Revoke an operator automation token")
    .argument("<id>", "Operator token ID")
    .action(async (id: string) => {
      try {
        const client = await createSessionApiClient();
        await client.revokeOperatorToken(id);
        success(`Operator token ${id} revoked.`);
      } catch (err) {
        error(errorMessage(err, "Failed to revoke operator token."));
        process.exit(1);
      }
    });

  return cmd;
}
