import { parseArgs } from "node:util";
import { ApiClient } from "../client";
import { requireConfig } from "../config";
import { error, errorMessage, json, success } from "../output";

export async function approveCommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      deny: { type: "boolean", default: false },
      reason: { type: "string" },
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const id = positionals[0];
  if (!id) {
    error("Usage: abadge approve <id> [--deny] [--reason '...']");
    process.exit(1);
  }

  const config = requireConfig();
  const client = new ApiClient(config);

  const action = values.deny ? "deny" : "approve";
  const body: Record<string, unknown> = {};
  if (values.reason) body.reason = values.reason;

  try {
    const result = await client.post(`/v1/approvals/${id}/${action}`, body);
    if (values.json) {
      json(result);
    } else {
      success(`Request ${id} ${action === "approve" ? "approved" : "denied"}.`);
    }
  } catch (err) {
    error(errorMessage(err, `Failed to ${action} request.`));
    process.exit(1);
  }
}
