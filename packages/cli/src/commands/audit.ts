import { Command } from "commander";
import { clearOperatorSessionIfExpired, createOperatorClient } from "../client";
import { error, errorMessage, json, table } from "../output";

export function createAuditCommand(): Command {
  return new Command("audit")
    .description("View access audit log")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      try {
        const client = await createOperatorClient();
        const entries = (await client.getAudit()).entries;

        if (opts.json) {
          json(entries);
          return;
        }

        table(
          entries.map((entry) => ({
            ID: String(entry.id),
            Agent: entry.agentId ?? "-",
            Item: entry.itemId ?? "-",
            Event: entry.eventType,
            Outcome: entry.result,
            Mode: entry.deliveryMode ?? "-",
            Time: entry.occurredAt,
          })),
        );
      } catch (err) {
        await clearOperatorSessionIfExpired(err);
        error(errorMessage(err, "Failed to fetch audit log."));
        process.exit(1);
      }
    });
}
