import { Command } from "commander";
import { createUserApiClient } from "../client";
import { error, errorMessage, json, table } from "../output";

function parseLimit(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function createAuditCommand(): Command {
  return new Command("audit")
    .description("View recent access audit events for the active organization")
    .option("--json", "Output as JSON")
    .option("--limit <count>", "Maximum number of entries to return")
    .option("--cursor <cursor>", "Pagination cursor from a previous page")
    .action(async (opts: { json?: boolean; limit?: string; cursor?: string }) => {
      try {
        const client = await createUserApiClient();
        const response = await client.audit.list({
          limit: parseLimit(opts.limit),
          cursor: opts.cursor,
        });

        if (opts.json) {
          json(response);
          return;
        }

        table(
          response.entries.map((entry) => ({
            ID: String(entry.id),
            Agent: entry.agentId ?? "-",
            Item: entry.itemId ?? "-",
            Event: entry.eventType,
            Outcome: entry.result,
            Mode: entry.deliveryMode ?? "-",
            Time: entry.occurredAt,
          })),
        );

        if (response.nextCursor) {
          console.log(`\nNext cursor: ${response.nextCursor}`);
        }
      } catch (err) {
        error(errorMessage(err, "Failed to fetch audit log."));
        process.exit(1);
      }
    });
}
