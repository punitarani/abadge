import { Command } from "commander";
import { ApiClient } from "../client";
import { requireConfig } from "../config";
import { error, errorMessage, json, table } from "../output";

export function createAuditCommand(): Command {
  return new Command("audit")
    .description("View access audit log")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const config = requireConfig();
      const client = new ApiClient(config);

      try {
        const entries = (await client.getAudit()).entries;

        if (opts.json) {
          json(entries);
          return;
        }

        table(
          entries.map((e) => ({
            ID: String(e.id),
            Agent: e.agentId ?? "-",
            Item: e.itemId ?? "-",
            Event: e.eventType,
            Outcome: e.result,
            Mode: e.deliveryMode ?? "-",
            Time: e.occurredAt,
          })),
        );
      } catch (err) {
        error(errorMessage(err, "Failed to fetch audit log."));
        process.exit(1);
      }
    });
}
