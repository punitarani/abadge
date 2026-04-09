import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { loadConfig, type McpConfig } from "./config.js";
import * as getAudit from "./tools/get-audit.js";
import * as listItems from "./tools/list-items.js";
import * as mountSecret from "./tools/mount-secret.js";
import * as releaseMount from "./tools/release-mount.js";
import * as runWithSecret from "./tools/run-with-secret.js";

function hasErrorField(text: string): boolean {
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && "error" in parsed;
  } catch {
    return false;
  }
}

function safeCall(
  // biome-ignore lint/suspicious/noExplicitAny: tool handlers have varying input types
  handler: (input: any, config: McpConfig) => Promise<string>,
  // biome-ignore lint/suspicious/noExplicitAny: input shape varies per tool
  input: any,
  config: McpConfig,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  return handler(input, config)
    .then((text) => ({
      content: [{ type: "text" as const, text }],
      ...(hasErrorField(text) ? { isError: true } : {}),
    }))
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "Unknown error";
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    });
}

// Zod v3.25 types are not structurally compatible with the MCP SDK's
// `zod/v3` re-export, causing "excessively deep" instantiation errors.
function shape(schema: { shape: Record<string, unknown> }): ZodRawShapeCompat {
  return schema.shape as ZodRawShapeCompat;
}

const tools = [listItems, runWithSecret, mountSecret, releaseMount, getAudit] as const;

function registerTools(server: McpServer, config: McpConfig): void {
  for (const tool of tools) {
    server.tool(tool.toolName, tool.toolDescription, shape(tool.toolInputSchema), (input) =>
      safeCall(tool.handler, input, config),
    );
  }
}

export async function startServer(): Promise<void> {
  let config: McpConfig;
  try {
    config = loadConfig();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Configuration error";
    console.error(`abadge-mcp: ${message}`);
    globalThis.process?.exit(1);
    return;
  }

  const server = new McpServer({
    name: "abadge-mcp",
    version: "0.0.0",
  });

  registerTools(server, config);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("abadge-mcp server running on stdio");
}
