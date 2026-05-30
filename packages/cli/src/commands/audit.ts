import type { AuditEventType, AuditQuery, AuditResult } from "@abadge/core";
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

export interface AuditCommandOptions {
  json?: boolean;
  limit?: string;
  cursor?: string;
  result?: string;
  agentId?: string;
  itemId?: string;
  eventType?: string;
}

/**
 * Map raw CLI flags to the audit query the SDK/server accepts. `result` and
 * `eventType` are literal unions on the server schema; cast the raw flag
 * values through and let the server's Effect Schema reject anything invalid
 * rather than re-listing the enums here.
 */
export function buildAuditFilters(opts: AuditCommandOptions): AuditQuery {
  return {
    limit: parseLimit(opts.limit),
    cursor: opts.cursor,
    result: opts.result as AuditResult | undefined,
    agentId: opts.agentId,
    itemId: opts.itemId,
    eventType: opts.eventType as AuditEventType | undefined,
  };
}

export function createAuditCommand(): Command {
  return new Command("audit")
    .description("View recent access audit events for the active organization")
    .option("--json", "Output as JSON")
    .option("--limit <count>", "Maximum number of entries to return")
    .option("--cursor <cursor>", "Pagination cursor from a previous page")
    .option("--result <result>", "Filter by outcome (allowed, denied, expired, revoked, cascade)")
    .option("--agent-id <id>", "Filter by agent ID")
    .option("--item-id <id>", "Filter by item ID")
    .option("--event-type <type>", "Filter by event type (e.g. access.reveal)")
    .action(async (opts: AuditCommandOptions) => {
      try {
        const client = await createUserApiClient();
        const response = await client.audit.list(buildAuditFilters(opts));

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
