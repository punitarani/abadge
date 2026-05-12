import { getCompiledRoutes } from "./v1";

/**
 * OpenAPI 3.1 document derived from the compiled REST routing table.
 *
 * Generated at module load (cold-start cost; cached in module scope). Each
 * compiled route becomes one `paths[template][method]` operation. We don't
 * serialize the Effect Schema input/output shapes — bridging Effect Schema
 * to JSON Schema is a separate task; the spec here is sufficient as a
 * route directory for clients and an integration test surface.
 *
 * The doc is the same shape whether served from `/v1/openapi.json` or
 * imported in tests; there's exactly one builder.
 */

interface OpenApiOperation {
  operationId: string;
  tags: string[];
  summary?: string;
  security?: Array<Record<string, string[]>>;
  parameters?: Array<{
    name: string;
    in: "path" | "query";
    required: boolean;
    schema: { type: "string" };
  }>;
  requestBody?: {
    required: boolean;
    content: { "application/json": { schema: { type: "object" } } };
  };
  responses: Record<
    string,
    {
      description: string;
      content?: { "application/json": { schema: { type: "object" } } };
    }
  >;
}

type OpenApiDocument = {
  openapi: "3.1.0";
  info: { title: string; version: string; description: string };
  servers: Array<{ url: string }>;
  externalDocs?: { url: string };
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: {
    securitySchemes: Record<string, { type: "http"; scheme: "bearer"; bearerFormat?: string }>;
  };
};

function buildOpenApiDocument(): OpenApiDocument {
  const paths: Record<string, Record<string, OpenApiOperation>> = {};

  for (const route of getCompiledRoutes()) {
    const pathItem = paths[route.template] ?? {};
    const method = route.method.toLowerCase();

    const parameters = route.paramNames.map((name) => ({
      name,
      in: "path" as const,
      required: true,
      schema: { type: "string" as const },
    }));

    const operation: OpenApiOperation = {
      operationId: route.procedurePath.replace(/\./g, "_"),
      tags: route.tags,
      ...(route.summary ? { summary: route.summary } : {}),
      ...(route.protect ? { security: [{ bearerAuth: [] }] } : {}),
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(route.trpcType === "mutation"
        ? {
            requestBody: {
              required: false,
              content: { "application/json": { schema: { type: "object" } } },
            },
          }
        : {}),
      responses: {
        "200": {
          description: "Success",
          content: { "application/json": { schema: { type: "object" } } },
        },
        "400": { description: "Bad Request" },
        "401": { description: "Unauthorized" },
        "403": { description: "Forbidden" },
        "404": { description: "Not Found" },
        "429": { description: "Too Many Requests" },
      },
    };

    pathItem[method] = operation;
    paths[route.template] = pathItem;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "abadge API",
      version: "1.0.0",
      description: "Credential control plane for AI agents.",
    },
    servers: [{ url: "https://api.abadge.dev/v1" }],
    externalDocs: { url: "https://docs.abadge.dev" },
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "abs_<token> or legacy_api_key",
        },
      },
    },
  };
}

// openApiDocument is built lazily on first request rather than at module load,
// matching the lazy ROUTES table in `./v1.ts`. This keeps the spec output
// robust to Bun test-runner ordering where `mock.module` registrations affect
// only subsequent imports. Production cost: one spec build on cold start.
let _document: OpenApiDocument | null = null;
export function getOpenApiDocument(): OpenApiDocument {
  if (_document === null) _document = buildOpenApiDocument();
  return _document;
}
