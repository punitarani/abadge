import { parseArgs } from "node:util";
import { ApiClient } from "../client";
import { requireConfig } from "../config";
import { error, errorMessage, json, table } from "../output";

export async function auditCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { json: { type: "boolean" } }, strict: false });
  const config = requireConfig();
  const client = new ApiClient(config);

  try {
    const entries = (await client.getAudit()).entries;

    if (values.json) {
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
}
