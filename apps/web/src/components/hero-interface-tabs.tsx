"use client";

import { Fragment, useState } from "react";

type HeroTab = "CLI" | "MCP" | "SDK" | "API";
type Tone =
  | "plain"
  | "muted"
  | "accent"
  | "string"
  | "number"
  | "keyword"
  | "property"
  | "type"
  | "comment"
  | "success"
  | "warning"
  | "prompt";
type Segment = {
  text: string;
  tone?: Tone;
};

type ToolExchange = {
  kind: "call" | "result";
  label: string;
  lines: Segment[][];
};

type HeroView = {
  id: HeroTab;
  chromeLabel: string;
  chromeMeta: string;
  footer: string;
};

const views = [
  {
    id: "CLI",
    chromeLabel: "local_cli · zsh",
    chromeMeta: "env injection",
    footer:
      "Local execution uses mount_env and injects into ABADGE_SECRET after permission checks.",
  },
  {
    id: "MCP",
    chromeLabel: "abadge mcp · stdio",
    chromeMeta: "tool session",
    footer: "The model sees tool IO only. Secret values stay out of the transcript.",
  },
  {
    id: "SDK",
    chromeLabel: "@abadge/sdk · TypeScript",
    chromeMeta: "typed client",
    footer:
      "The same client manages agents with a session token and accesses items with an API key.",
  },
  {
    id: "API",
    chromeLabel: "REST v1 · access.mount",
    chromeMeta: "audited mutation",
    footer: "Access endpoints are POST mutations because every attempt writes audit state.",
  },
] satisfies [HeroView, ...HeroView[]];

const cliLines: Segment[][] = [
  [
    { text: "$", tone: "prompt" },
    { text: " abadge agent register", tone: "plain" },
    { text: " \\", tone: "muted" },
  ],
  [
    { text: "  --name", tone: "accent" },
    { text: ' "release-bot"', tone: "string" },
    { text: " \\", tone: "muted" },
  ],
  [
    { text: "  --kind", tone: "accent" },
    { text: " local_cli", tone: "type" },
  ],
  [
    {
      text: '✓ Agent "release-bot" registered (id: 7dc3d0c2-2f93-4b85-9d11-2608d43602fb).',
      tone: "success",
    },
  ],
  [{ text: "! Save this API key - it will NOT be shown again:", tone: "warning" }],
  [{ text: "  abl_L1vt0yxS5u9v4y3dA5iF4n0o6h2k...", tone: "accent" }],
  [{ text: "" }],
  [
    { text: "$", tone: "prompt" },
    { text: " abadge permission create", tone: "plain" },
    { text: " \\", tone: "muted" },
  ],
  [
    { text: "  --agent-id", tone: "accent" },
    { text: " 7dc3d0c2-2f93-4b85-9d11-2608d43602fb", tone: "plain" },
    { text: " \\", tone: "muted" },
  ],
  [
    { text: "  --item-id", tone: "accent" },
    { text: " 3f02c7c4-7f9f-4c59-91ac-8fb882c6de19", tone: "plain" },
    { text: " \\", tone: "muted" },
  ],
  [
    { text: "  --capability", tone: "accent" },
    { text: " mount_env", tone: "type" },
  ],
  [{ text: "✓ Permission created.", tone: "success" }],
  [{ text: "" }],
  [
    { text: "$", tone: "prompt" },
    { text: " abadge run", tone: "plain" },
    { text: " --item", tone: "accent" },
    { text: " 3f02c7c4-7f9f-4c59-91ac-8fb882c6de19", tone: "plain" },
    { text: " -- \\", tone: "muted" },
  ],
  [
    { text: "  sh", tone: "plain" },
    { text: " -lc", tone: "accent" },
    {
      text: ` 'curl -sS -H "Authorization: Bearer $ABADGE_SECRET" https://registry.npmjs.org/-/whoami'`,
      tone: "string",
    },
  ],
  [
    { text: "{", tone: "muted" },
    { text: '"username"', tone: "property" },
    { text: ":", tone: "muted" },
    { text: '"release-bot"', tone: "string" },
    { text: "}", tone: "muted" },
  ],
];

const sdkLines: Segment[][] = [
  [
    { text: "import ", tone: "keyword" },
    { text: "{ AbadgeClient }", tone: "type" },
    { text: " from ", tone: "keyword" },
    { text: '"@abadge/sdk"', tone: "string" },
    { text: ";", tone: "muted" },
  ],
  [{ text: "" }],
  [
    { text: "const", tone: "keyword" },
    { text: " operator", tone: "plain" },
    { text: " = new ", tone: "keyword" },
    { text: "AbadgeClient", tone: "type" },
    { text: "({", tone: "muted" },
  ],
  [
    { text: "  apiUrl", tone: "property" },
    { text: ": ", tone: "muted" },
    { text: '"https://api.abadge.dev"', tone: "string" },
    { text: ",", tone: "muted" },
  ],
  [
    { text: "  token", tone: "property" },
    { text: ": ", tone: "muted" },
    { text: "process.env.ABADGE_SESSION!", tone: "accent" },
  ],
  [{ text: "});", tone: "muted" }],
  [{ text: "" }],
  [
    { text: "const", tone: "keyword" },
    { text: " { agent, apiKey }", tone: "plain" },
    { text: " = await ", tone: "keyword" },
    { text: "operator.createAgent", tone: "type" },
    { text: "({", tone: "muted" },
  ],
  [
    { text: "  kind", tone: "property" },
    { text: ": ", tone: "muted" },
    { text: '"local_mcp"', tone: "string" },
    { text: ",", tone: "muted" },
  ],
  [
    { text: "  name", tone: "property" },
    { text: ": ", tone: "muted" },
    { text: '"claude-desktop"', tone: "string" },
  ],
  [{ text: "});", tone: "muted" }],
  [{ text: "" }],
  [
    { text: "await ", tone: "keyword" },
    { text: "operator.createPermission", tone: "type" },
    { text: "({", tone: "muted" },
  ],
  [
    { text: "  agentId", tone: "property" },
    { text: ": ", tone: "muted" },
    { text: "agent.id", tone: "plain" },
    { text: ",", tone: "muted" },
  ],
  [
    { text: "  itemId", tone: "property" },
    { text: ": ", tone: "muted" },
    { text: "process.env.NPM_TOKEN_ITEM_ID!", tone: "accent" },
    { text: ",", tone: "muted" },
  ],
  [
    { text: "  capability", tone: "property" },
    { text: ": ", tone: "muted" },
    { text: '"mount_env"', tone: "string" },
    { text: ",", tone: "muted" },
  ],
  [
    { text: "  expiresAt", tone: "property" },
    { text: ": ", tone: "muted" },
    { text: '"2026-04-02T18:30:00.000Z"', tone: "string" },
  ],
  [{ text: "});", tone: "muted" }],
  [{ text: "" }],
  [
    { text: "const", tone: "keyword" },
    { text: " audit", tone: "plain" },
    { text: " = await ", tone: "keyword" },
    { text: "operator.getAudit", tone: "type" },
    { text: "({", tone: "muted" },
  ],
  [
    { text: "  agentId", tone: "property" },
    { text: ": ", tone: "muted" },
    { text: "agent.id", tone: "plain" },
    { text: ",", tone: "muted" },
  ],
  [
    { text: "  eventType", tone: "property" },
    { text: ": ", tone: "muted" },
    { text: '"access.mount_env"', tone: "string" },
    { text: ",", tone: "muted" },
  ],
  [
    { text: "  limit", tone: "property" },
    { text: ": ", tone: "muted" },
    { text: "10", tone: "number" },
  ],
  [{ text: "});", tone: "muted" }],
  [{ text: "" }],
  [
    { text: "console.log", tone: "type" },
    { text: "({ apiKey, lastAccess: audit.entries[0]?.createdAt ?? ", tone: "plain" },
    { text: "null", tone: "keyword" },
    { text: " });", tone: "plain" },
  ],
];

const requestLines: Segment[][] = [
  [{ text: "{", tone: "muted" }],
  [
    { text: '  "itemId"', tone: "property" },
    { text: ": ", tone: "muted" },
    { text: '"3f02c7c4-7f9f-4c59-91ac-8fb882c6de19"', tone: "string" },
    { text: ",", tone: "muted" },
  ],
  [
    { text: '  "mountType"', tone: "property" },
    { text: ": ", tone: "muted" },
    { text: '"env"', tone: "string" },
  ],
  [{ text: "}", tone: "muted" }],
];

const responseLines: Segment[][] = [
  [{ text: "{", tone: "muted" }],
  [
    { text: '  "storageMode"', tone: "property" },
    { text: ": ", tone: "muted" },
    { text: '"zero_knowledge"', tone: "string" },
    { text: ",", tone: "muted" },
  ],
  [
    { text: '  "encryptedItemKey"', tone: "property" },
    { text: ": ", tone: "muted" },
    { text: '"a31BqJ3f+2B6RZq2pDq9R6XwP1m2xN2m=="', tone: "string" },
    { text: ",", tone: "muted" },
  ],
  [
    { text: '  "ciphertext"', tone: "property" },
    { text: ": ", tone: "muted" },
    { text: '"Qk2aBmdv9rKzA0g1Oeb7j5+4f0uE6Q7k7J8cF5m7Q4b=="', tone: "string" },
    { text: ",", tone: "muted" },
  ],
  [
    { text: '  "cryptoVersion"', tone: "property" },
    { text: ": ", tone: "muted" },
    { text: "1", tone: "number" },
  ],
  [{ text: "}", tone: "muted" }],
];

const mcpExchanges: ToolExchange[] = [
  {
    kind: "call",
    label: "list_items",
    lines: [[{ text: "{}", tone: "muted" }]],
  },
  {
    kind: "result",
    label: "result",
    lines: [
      [{ text: "{", tone: "muted" }],
      [
        { text: '  "items"', tone: "property" },
        { text: ": [", tone: "muted" },
      ],
      [{ text: "    {", tone: "muted" }],
      [
        { text: '      "id"', tone: "property" },
        { text: ": ", tone: "muted" },
        { text: '"3f02c7c4-7f9f-4c59-91ac-8fb882c6de19"', tone: "string" },
        { text: ",", tone: "muted" },
      ],
      [
        { text: '      "storageMode"', tone: "property" },
        { text: ": ", tone: "muted" },
        { text: '"server_managed"', tone: "string" },
        { text: ",", tone: "muted" },
      ],
      [
        { text: '      "contentVersion"', tone: "property" },
        { text: ": ", tone: "muted" },
        { text: "4", tone: "number" },
      ],
      [{ text: "    }", tone: "muted" }],
      [{ text: "  ]", tone: "muted" }],
      [{ text: "}", tone: "muted" }],
    ],
  },
  {
    kind: "call",
    label: "request_access",
    lines: [
      [{ text: "{", tone: "muted" }],
      [
        { text: '  "itemId"', tone: "property" },
        { text: ": ", tone: "muted" },
        { text: '"3f02c7c4-7f9f-4c59-91ac-8fb882c6de19"', tone: "string" },
        { text: ",", tone: "muted" },
      ],
      [
        { text: '  "capability"', tone: "property" },
        { text: ": ", tone: "muted" },
        { text: '"mount_env"', tone: "string" },
        { text: ",", tone: "muted" },
      ],
      [
        { text: '  "purpose"', tone: "property" },
        { text: ": ", tone: "muted" },
        { text: '"Publish @abadge/sdk v0.1.0 to npm"', tone: "string" },
      ],
      [{ text: "}", tone: "muted" }],
    ],
  },
  {
    kind: "result",
    label: "result",
    lines: [
      [{ text: "{", tone: "muted" }],
      [
        { text: '  "status"', tone: "property" },
        { text: ": ", tone: "muted" },
        { text: '"granted"', tone: "string" },
        { text: ",", tone: "muted" },
      ],
      [
        { text: '  "itemId"', tone: "property" },
        { text: ": ", tone: "muted" },
        { text: '"3f02c7c4-7f9f-4c59-91ac-8fb882c6de19"', tone: "string" },
        { text: ",", tone: "muted" },
      ],
      [
        { text: '  "capability"', tone: "property" },
        { text: ": ", tone: "muted" },
        { text: '"mount_env"', tone: "string" },
      ],
      [{ text: "}", tone: "muted" }],
    ],
  },
  {
    kind: "call",
    label: "run_with_secret",
    lines: [
      [{ text: "{", tone: "muted" }],
      [
        { text: '  "itemId"', tone: "property" },
        { text: ": ", tone: "muted" },
        { text: '"3f02c7c4-7f9f-4c59-91ac-8fb882c6de19"', tone: "string" },
        { text: ",", tone: "muted" },
      ],
      [
        { text: '  "command"', tone: "property" },
        { text: ": ", tone: "muted" },
        { text: '"npm"', tone: "string" },
        { text: ",", tone: "muted" },
      ],
      [
        { text: '  "args"', tone: "property" },
        { text: ": ", tone: "muted" },
        { text: '["publish", "--access", "public"]', tone: "plain" },
        { text: ",", tone: "muted" },
      ],
      [
        { text: '  "envVarName"', tone: "property" },
        { text: ": ", tone: "muted" },
        { text: '"NPM_TOKEN"', tone: "string" },
      ],
      [{ text: "}", tone: "muted" }],
    ],
  },
  {
    kind: "result",
    label: "result",
    lines: [
      [{ text: "{", tone: "muted" }],
      [
        { text: '  "exitCode"', tone: "property" },
        { text: ": ", tone: "muted" },
        { text: "0", tone: "number" },
        { text: ",", tone: "muted" },
      ],
      [
        { text: '  "stdout"', tone: "property" },
        { text: ": ", tone: "muted" },
        { text: '"+ @abadge/sdk@0.1.0"', tone: "string" },
        { text: ",", tone: "muted" },
      ],
      [
        { text: '  "stderr"', tone: "property" },
        { text: ": ", tone: "muted" },
        { text: '""', tone: "string" },
      ],
      [{ text: "}", tone: "muted" }],
    ],
  },
];

function toneClass(tone: Tone | undefined): string {
  switch (tone) {
    case "muted":
      return "text-[#5F708A]";
    case "accent":
      return "text-[#7CB2FF]";
    case "string":
      return "text-[#A6E17D]";
    case "number":
      return "text-[#F6C970]";
    case "keyword":
      return "text-[#FF8FAB]";
    case "property":
      return "text-[#BFD1F6]";
    case "type":
      return "text-[#82AFFF]";
    case "comment":
      return "text-[#617089]";
    case "success":
      return "text-[#84E1A7]";
    case "warning":
      return "text-[#FFCC80]";
    case "prompt":
      return "text-[#7CB2FF]";
    default:
      return "text-[#E6EDF7]";
  }
}

function Segments({ segments }: { segments: Segment[] }) {
  if (segments.length === 0) {
    return <span>&nbsp;</span>;
  }

  let segmentKey = "";

  return (
    <>
      {segments.map((segment) => {
        segmentKey += `${segment.tone ?? "plain"}:${segment.text}|`;

        return (
          <span key={segmentKey} className={toneClass(segment.tone)}>
            {segment.text}
          </span>
        );
      })}
    </>
  );
}

function CodeBlock({
  lines,
  lineNumbers = false,
  className = "",
}: {
  lines: Segment[][];
  lineNumbers?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-[18px] border border-[#1B273A] bg-[#070D17] ${className}`}
    >
      <div className="overflow-x-auto px-4 py-4 [font-family:var(--font-landing-mono)] text-[11px] leading-[1.85] md:text-[12px]">
        {lineNumbers
          ? (() => {
              let lineNumber = 0;
              let lineKey = "";

              return (
                <div className="grid w-max min-w-full grid-cols-[2rem_minmax(0,1fr)] gap-x-4">
                  {lines.map((line) => {
                    lineNumber += 1;
                    lineKey += line
                      .map((segment) => `${segment.tone ?? "plain"}:${segment.text}`)
                      .join("|");

                    return (
                      <Fragment key={lineKey}>
                        <div className="select-none text-right text-[#4F6079]">{lineNumber}</div>
                        <div className="whitespace-pre">
                          <Segments segments={line} />
                        </div>
                      </Fragment>
                    );
                  })}
                </div>
              );
            })()
          : (() => {
              let lineKey = "";

              return (
                <div className="w-max min-w-full space-y-0 whitespace-pre">
                  {lines.map((line) => {
                    lineKey += line
                      .map((segment) => `${segment.tone ?? "plain"}:${segment.text}`)
                      .join("|");

                    return (
                      <div key={lineKey}>
                        <Segments segments={line} />
                      </div>
                    );
                  })}
                </div>
              );
            })()}
      </div>
    </div>
  );
}

function SurfaceHeader({ title, meta, detail }: { title: string; meta: string; detail?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[#1A2537] px-4 py-3">
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#7D8EA9]">
          {meta}
        </div>
        <div className="mt-1 truncate text-sm font-semibold text-[#E6EDF7]">{title}</div>
      </div>
      {detail ? (
        <div className="rounded-full border border-[#22324A] bg-[#0C1422] px-3 py-1 text-[10px] font-medium text-[#9EB2D2]">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

function CliView() {
  return (
    <div className="flex h-full min-w-0 flex-col rounded-[22px] border border-[#192538] bg-[#050B14]">
      <SurfaceHeader meta="terminal" title="release@mbp ~/worktrees/abadge" detail="zsh" />
      <div className="flex-1 overflow-auto p-4">
        <CodeBlock lines={cliLines} className="h-full bg-[#050B14]" />
      </div>
    </div>
  );
}

function McpView() {
  return (
    <div className="grid h-full min-w-0 gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <div className="min-w-0 rounded-[22px] border border-[#192538] bg-[#050B14]">
        <SurfaceHeader meta="server" title="abadge" detail="stdio" />
        <div className="space-y-5 p-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#6C7E9B]">
              connection
            </div>
            <div className="mt-3 space-y-2 text-[11px] text-[#C7D4E7]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[#7D8EA9]">command</span>
                <span className="[font-family:var(--font-landing-mono)]">abadge mcp</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[#7D8EA9]">agent</span>
                <span>local_mcp</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[#7D8EA9]">auth</span>
                <span className="[font-family:var(--font-landing-mono)]">abl_••••••••</span>
              </div>
            </div>
          </div>

          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#6C7E9B]">
              tools
            </div>
            <div className="mt-3 space-y-2">
              {["list_items", "request_access", "run_with_secret", "mount_secret"].map((tool) => (
                <div
                  key={tool}
                  className={`rounded-full border px-3 py-1.5 text-[11px] [font-family:var(--font-landing-mono)] ${
                    tool === "run_with_secret"
                      ? "border-[#2A4670] bg-[#0D1B30] text-[#E6EDF7]"
                      : "border-[#1F2D43] bg-[#0A1321] text-[#8FA3C3]"
                  }`}
                >
                  {tool}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="min-w-0 rounded-[22px] border border-[#192538] bg-[#050B14]">
        <SurfaceHeader meta="agent transcript" title="Claude Desktop" detail="secret-safe flow" />
        <div className="space-y-3 overflow-auto p-4">
          {mcpExchanges.map((exchange) => (
            <div
              key={`${exchange.kind}-${exchange.label}-${serializeLines(exchange.lines)}`}
              className={`overflow-hidden rounded-[18px] border ${
                exchange.kind === "call"
                  ? "border-[#1F3351] bg-[#091423]"
                  : "border-[#193127] bg-[#081610]"
              }`}
            >
              <div className="flex items-center justify-between border-b border-white/8 px-4 py-2">
                <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#7D8EA9]">
                  {exchange.kind === "call" ? "tool call" : "tool result"}
                </div>
                <div className="text-[11px] [font-family:var(--font-landing-mono)] text-[#E6EDF7]">
                  {exchange.label}
                </div>
              </div>
              <CodeBlock lines={exchange.lines} className="border-0 bg-transparent" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SdkView() {
  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden rounded-[22px] border border-[#192538] bg-[#050B14]">
      <div className="flex items-center justify-between gap-3 border-b border-[#1A2537] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="rounded-full border border-[#253754] bg-[#091423] px-3 py-1 text-[10px] font-medium text-[#A3B7D8]">
            packages/sdk/examples
          </div>
          <div className="truncate rounded-full border border-[#253754] bg-[#0B1524] px-3 py-1 text-[10px] font-medium text-[#E6EDF7]">
            release-agent.ts
          </div>
        </div>
        <div className="rounded-full border border-[#253754] bg-[#0C1422] px-3 py-1 text-[10px] font-medium text-[#9EB2D2]">
          TypeScript
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <CodeBlock lines={sdkLines} lineNumbers className="h-full" />
      </div>
    </div>
  );
}

function ApiView() {
  return (
    <div className="flex h-full min-w-0 flex-col gap-4">
      <div className="flex min-w-0 items-center gap-3 overflow-x-auto rounded-[18px] border border-[#1B273A] bg-[#070D17] px-4 py-3">
        <div className="rounded-full border border-[#2E4D7B] bg-[#10203A] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#9EC2FF]">
          POST
        </div>
        <div className="min-w-0 truncate [font-family:var(--font-landing-mono)] text-[11px] text-[#E6EDF7] md:text-[12px]">
          https://api.abadge.dev/v1/access/mount
        </div>
      </div>

      <div className="grid min-w-0 flex-1 gap-4 xl:grid-cols-2">
        <div className="min-w-0 rounded-[22px] border border-[#192538] bg-[#050B14]">
          <SurfaceHeader meta="request" title="Authorization: Bearer abl_••••••••" />
          <div className="space-y-4 p-4">
            <div className="rounded-[18px] border border-[#1B273A] bg-[#070D17] px-4 py-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#6C7E9B]">
                headers
              </div>
              <div className="mt-3 space-y-2 text-[11px] text-[#C7D4E7]">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[#7D8EA9]">Authorization</span>
                  <span className="[font-family:var(--font-landing-mono)]">
                    Bearer abl_••••••••
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[#7D8EA9]">Content-Type</span>
                  <span className="[font-family:var(--font-landing-mono)]">application/json</span>
                </div>
              </div>
            </div>

            <div>
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.24em] text-[#6C7E9B]">
                body
              </div>
              <CodeBlock lines={requestLines} />
            </div>
          </div>
        </div>

        <div className="min-w-0 rounded-[22px] border border-[#192538] bg-[#050B14]">
          <SurfaceHeader meta="response" title="200 OK" detail="access.mount_env" />
          <div className="space-y-4 p-4">
            <CodeBlock lines={responseLines} />
            <div className="rounded-[18px] border border-[#173327] bg-[#081610] px-4 py-3 text-[11px] leading-[1.7] text-[#B9D6C4]">
              Side effect: an{" "}
              <span className="[font-family:var(--font-landing-mono)]">access.mount_env</span> audit
              entry is written even when the request is denied or expired.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function serializeLines(lines: Segment[][]): string {
  return lines
    .map((line) => line.map((segment) => `${segment.tone ?? "plain"}:${segment.text}`).join("|"))
    .join("::");
}

function ActivePanel({ activeTab }: { activeTab: HeroTab }) {
  switch (activeTab) {
    case "CLI":
      return <CliView />;
    case "MCP":
      return <McpView />;
    case "SDK":
      return <SdkView />;
    case "API":
      return <ApiView />;
  }
}

export function HeroInterfaceTabs() {
  const [activeTab, setActiveTab] = useState<HeroTab>("CLI");
  const activeView = views.find((view) => view.id === activeTab) ?? views[0];

  return (
    <div className="w-full min-w-0 max-w-[42rem] overflow-hidden rounded-[28px] border border-[#0F1726] bg-[#030813] shadow-[0_30px_120px_rgba(3,8,19,0.45)]">
      <div className="border-b border-[#182436] bg-[linear-gradient(180deg,rgba(25,41,68,0.92),rgba(8,14,24,0.98))] px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#FF6B6B]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#F7C948]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#2DD4BF]" />
            <span className="ml-2 text-[10px] font-bold uppercase tracking-[0.3em] text-[#95A6C2]">
              Interface Surface
            </span>
          </div>

          <div className="hidden rounded-full border border-[#203049] bg-[#09111D] px-3 py-1 text-[10px] font-medium text-[#A6B7D1] md:block">
            {activeView.chromeLabel}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {views.map((view) => {
            const isActive = view.id === activeTab;

            return (
              <button
                key={view.id}
                type="button"
                onClick={() => setActiveTab(view.id)}
                className={`rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] transition-all ${
                  isActive
                    ? "border-[#4F7BC1] bg-[#10203A] text-[#EAF2FF]"
                    : "border-[#213049] bg-[#0A1321] text-[#7F92AF] hover:border-[#304564] hover:text-[#C6D4E9]"
                }`}
              >
                {view.id}
              </button>
            );
          })}
        </div>

        <div className="mt-3 text-[11px] text-[#8CA0BD]">{activeView.chromeMeta}</div>
      </div>

      <div className="min-h-[31rem] bg-[radial-gradient(circle_at_top,rgba(53,94,168,0.16),transparent_36%),linear-gradient(180deg,#040914_0%,#030711_100%)] p-4 md:min-h-[33rem] md:p-5">
        <ActivePanel activeTab={activeTab} />
      </div>

      <div className="border-t border-[#182436] bg-[#050B14] px-4 py-3 text-[11px] leading-[1.7] text-[#8CA0BD]">
        {activeView.footer}
      </div>
    </div>
  );
}
