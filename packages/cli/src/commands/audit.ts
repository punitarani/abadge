import { parseArgs } from "node:util";
import { ApiClient } from "../client";
import { requireConfig } from "../config";
import { error, errorMessage, json, table } from "../output";

interface AuditEntry {
  timestamp: string;
  agentId: string;
  credentialId: string;
  outcome: string;
  deliveryMode?: string;
  ip?: string;
}

export async function auditCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      limit: { type: "string", default: "20" },
      json: { type: "boolean", default: false },
    },
    strict: false,
  });

  const config = requireConfig();
  const client = new ApiClient(config);

  try {
    const entries = await client.get<AuditEntry[]>(`/api/audit?limit=${values.limit}`);
    if (values.json) {
      json(entries);
    } else {
      table(
        entries.map((e) => ({
          Time: e.timestamp,
          Agent: e.agentId,
          Credential: e.credentialId,
          Outcome: e.outcome,
          Mode: e.deliveryMode ?? "-",
          IP: e.ip ?? "-",
        })),
      );
    }
  } catch (err) {
    error(errorMessage(err, "Failed to fetch audit log."));
    process.exit(1);
  }
}
