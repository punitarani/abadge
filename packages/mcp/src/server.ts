import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { loadConfig, type McpConfig } from "./config.js";
import * as fillLogin from "./tools/fill-login.js";
import * as getAudit from "./tools/get-audit.js";
import * as getMetadata from "./tools/get-metadata.js";
import * as listCredentials from "./tools/list-credentials.js";
import * as mountSecret from "./tools/mount-secret.js";
import * as requestApproval from "./tools/request-approval.js";
import * as requestSecret from "./tools/request-secret.js";
import * as runWithSecret from "./tools/run-with-secret.js";

function safeCall(
  // biome-ignore lint/suspicious/noExplicitAny: tool handlers have varying input types
  handler: (input: any, config: McpConfig) => Promise<string>,
  // biome-ignore lint/suspicious/noExplicitAny: input shape varies per tool
  input: any,
  config: McpConfig,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  return handler(input, config)
    .then((text) => ({ content: [{ type: "text" as const, text }] }))
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
// Cast each .shape to ZodRawShapeCompat to satisfy the SDK generics.
function shape(schema: { shape: Record<string, unknown> }): ZodRawShapeCompat {
  return schema.shape as ZodRawShapeCompat;
}

function registerTools(server: McpServer, config: McpConfig): void {
  server.tool(
    listCredentials.toolName,
    listCredentials.toolDescription,
    shape(listCredentials.toolInputSchema),
    (input) => safeCall(listCredentials.handler, input, config),
  );

  server.tool(
    requestSecret.toolName,
    requestSecret.toolDescription,
    shape(requestSecret.toolInputSchema),
    (input) => safeCall(requestSecret.handler, input, config),
  );

  server.tool(
    requestApproval.toolName,
    requestApproval.toolDescription,
    shape(requestApproval.toolInputSchema),
    (input) => safeCall(requestApproval.handler, input, config),
  );

  server.tool(
    getMetadata.toolName,
    getMetadata.toolDescription,
    shape(getMetadata.toolInputSchema),
    (input) => safeCall(getMetadata.handler, input, config),
  );

  server.tool(
    getAudit.toolName,
    getAudit.toolDescription,
    shape(getAudit.toolInputSchema),
    (input) => safeCall(getAudit.handler, input, config),
  );

  server.tool(
    runWithSecret.toolName,
    runWithSecret.toolDescription,
    shape(runWithSecret.toolInputSchema),
    (input) => safeCall(runWithSecret.handler, input, config),
  );

  server.tool(
    fillLogin.toolName,
    fillLogin.toolDescription,
    shape(fillLogin.toolInputSchema),
    (input) => safeCall(fillLogin.handler, input, config),
  );

  server.tool(
    mountSecret.toolName,
    mountSecret.toolDescription,
    shape(mountSecret.toolInputSchema),
    (input) => safeCall(mountSecret.handler, input, config),
  );
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
