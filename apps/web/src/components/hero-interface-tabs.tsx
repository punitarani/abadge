"use client";

import { Check, Copy } from "lucide-react";
import { type ReactNode, useState } from "react";

type ViewId = "cli" | "mcp" | "sdk" | "api";
type BadgeTone = "blue" | "green" | "slate";
type LineTone = "blue" | "default" | "muted" | "success";

type SurfaceSection = {
  accent?: boolean;
  content: ReactNode;
  detail?: string;
  detailTone?: BadgeTone;
  label: string;
};

type SurfaceView = {
  chrome: string;
  footnote: ReactNode;
  id: ViewId;
  label: string;
  sections: SurfaceSection[];
};

function badgeClass(tone: BadgeTone): string {
  switch (tone) {
    case "blue":
      return "bg-[#eef4ff] text-[#4f7df7]";
    case "green":
      return "bg-[#eefbf1] text-[#2e9d4d]";
    default:
      return "bg-[#f3f5f8] text-[#667085]";
  }
}

function lineClass(tone: LineTone): string {
  switch (tone) {
    case "blue":
      return "text-[#4f7df7]";
    case "muted":
      return "text-[#9aa3b2]";
    case "success":
      return "text-[#2e9d4d]";
    default:
      return "text-[#667085]";
  }
}

function ShellLine({
  children,
  indent = 0,
  prompt,
  tone = "default",
}: {
  children: ReactNode;
  indent?: number;
  prompt?: string;
  tone?: LineTone;
}) {
  return (
    <div
      className={`w-full whitespace-pre-wrap break-words text-[12px] leading-[1.55] md:text-[13px] xl:min-w-max xl:whitespace-nowrap xl:text-[14px] ${lineClass(tone)}`}
      style={{ paddingLeft: `${indent * 24}px` }}
    >
      {prompt ? <span className="mr-2 font-bold text-[#111827]">{prompt}</span> : null}
      {children}
    </div>
  );
}

function CopyCommandLine({
  children,
  command,
  tone = "default",
}: {
  children: ReactNode;
  command: string;
  tone?: LineTone;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      title="Click to copy"
      className="-mx-2 inline-flex max-w-full items-center gap-2.5 rounded-[0.8rem] px-2 py-1 text-left transition hover:bg-[#f6f9ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7e5ff]"
    >
      <span
        className={`inline-flex h-5 w-5 items-center justify-center rounded-[0.45rem] border ${
          copied
            ? "border-[#b8e2c5] bg-[#eefbf1] text-[#2e9d4d]"
            : "border-[#e3e8ef] bg-[#f8fafc] text-[#8a94a6]"
        }`}
      >
        {copied ? (
          <Check className="h-3.25 w-3.25" strokeWidth={2.1} />
        ) : (
          <Copy className="h-3.25 w-3.25" strokeWidth={2.1} />
        )}
      </span>
      <span
        className={`whitespace-pre-wrap break-words text-[12px] leading-[1.55] md:text-[13px] xl:whitespace-nowrap xl:text-[14px] ${lineClass(tone)}`}
      >
        {children}
      </span>
    </button>
  );
}

function SectionBadge({ children, tone = "slate" }: { children: ReactNode; tone?: BadgeTone }) {
  return (
    <span
      className={`rounded-[0.55rem] px-3 py-1 text-[10px] font-bold tracking-[0.06em] [font-family:var(--font-landing-mono)] ${badgeClass(tone)}`}
    >
      {children}
    </span>
  );
}

function Footnote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 pl-8 text-[12px] font-semibold italic text-[#4f7df7] [font-family:var(--font-landing-mono)]">
      <span className="h-2.5 w-2.5 rounded-full bg-[#9ec0ff]" />
      <span>{children}</span>
    </div>
  );
}

function SurfaceSectionBlock({
  accent,
  content,
  detail,
  detailTone = "slate",
  label,
}: SurfaceSection) {
  return (
    <section className="relative pl-8">
      {accent ? (
        <span className="absolute top-9 left-0 h-[4.9rem] w-[4px] rounded-full bg-[#4f7df7]" />
      ) : null}
      <div className="flex items-center justify-between gap-4">
        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#a4adba] [font-family:var(--font-landing-mono)]">
          {label}
        </span>
        {detail ? <SectionBadge tone={detailTone}>{detail}</SectionBadge> : null}
      </div>
      <div className="mt-2.5 overflow-x-auto [font-family:var(--font-landing-mono)]">{content}</div>
    </section>
  );
}

const views: SurfaceView[] = [
  {
    id: "cli",
    label: "CLI",
    chrome: "local cli · zsh",
    footnote: <Footnote>mount_env injects into ABADGE_SECRET only at subprocess time.</Footnote>,
    sections: [
      {
        accent: true,
        label: "Bootstrap",
        detail: "machine setup",
        detailTone: "blue",
        content: (
          <>
            <CopyCommandLine command={`curl -fsSL https://abadge.io/install | bash`}>
              <span className="text-[#4f7df7]">curl</span>
              <span> -fsSL https://abadge.io/install | bash</span>
            </CopyCommandLine>
            <ShellLine tone="muted">installed abadge · ~/.local/bin/abadge</ShellLine>
          </>
        ),
      },
      {
        label: "Session",
        detail: "auth + run",
        detailTone: "slate",
        content: (
          <>
            <ShellLine prompt="$">
              <span className="font-semibold text-[#111827]">abadge login</span>
              <span> {" \\"}</span>
            </ShellLine>
            <ShellLine indent={1}>
              <span>--api-url </span>
              <span className="text-[#4f7df7]">https://api.abadge.io</span>
            </ShellLine>
            <ShellLine tone="muted">operator session stored only in local daemon memory</ShellLine>
            <ShellLine prompt="$">
              <span className="font-semibold text-[#111827]">abadge agent register</span>
              <span> {" \\"}</span>
            </ShellLine>
            <ShellLine indent={1}>
              <span>--name </span>
              <span className="text-[#4f7df7]">"claude-desktop"</span>
              <span> --kind </span>
              <span className="text-[#4f7df7]">local_cli</span>
            </ShellLine>
            <ShellLine prompt="$">
              <span className="font-semibold text-[#111827]">abadge permission create</span>
              <span> {" \\"}</span>
            </ShellLine>
            <ShellLine indent={1}>
              <span>--agent-id </span>
              <span className="text-[#4f7df7]">a1b2c3d4-...</span>
              <span> --item-id </span>
              <span className="text-[#4f7df7]">e5f6g7h8-...</span>
            </ShellLine>
            <ShellLine indent={1}>
              <span>--capability </span>
              <span className="text-[#4f7df7]">mount_env</span>
            </ShellLine>
            <ShellLine prompt="$">
              <span className="font-semibold text-[#111827]">abadge run</span>
              <span> {" \\"}</span>
            </ShellLine>
            <ShellLine indent={1}>
              <span>--item </span>
              <span className="text-[#4f7df7]">e5f6g7h8-...</span>
              <span> -- sh -lc</span>
            </ShellLine>
            <ShellLine indent={2} tone="blue">
              {'"curl -sS -H \\"Authorization: Bearer $ABADGE_SECRET\\" \\'}
            </ShellLine>
            <ShellLine indent={2} tone="blue">
              {'https://registry.npmjs.org/-/whoami"'}
            </ShellLine>
          </>
        ),
      },
    ],
  },
  {
    id: "mcp",
    label: "MCP",
    chrome: "Any MCP Client · STDIO",
    footnote: (
      <Footnote>
        Tool responses include metadata and process output, never raw secret values.
      </Footnote>
    ),
    sections: [
      {
        accent: true,
        label: "Register",
        detail: "local_mcp",
        detailTone: "blue",
        content: (
          <>
            <CopyCommandLine command={`abadge login`}>
              <span className="font-semibold text-[#111827]">abadge login</span>
            </CopyCommandLine>
            <ShellLine tone="muted">
              provisions local_mcp metadata in ~/.abadge/config.json
            </ShellLine>
            <CopyCommandLine command={`abadge agent register -n "claude-desktop" -k local_mcp`}>
              <span className="font-semibold text-[#111827]">abadge agent register</span>
              <span> -n </span>
              <span className="text-[#4f7df7]">"claude-desktop"</span>
              <span> -k </span>
              <span className="text-[#4f7df7]">local_mcp</span>
            </CopyCommandLine>
          </>
        ),
      },
      {
        label: "Claude Desktop",
        detail: "stdio config",
        detailTone: "slate",
        content: (
          <>
            <ShellLine>{`"mcpServers": {`}</ShellLine>
            <ShellLine indent={1}>{`"abadge": {`}</ShellLine>
            <ShellLine indent={2}>{`"command": "abadge",`}</ShellLine>
            <ShellLine indent={2}>{`"args": ["mcp"],`}</ShellLine>
            <ShellLine indent={2}>{`"env": {`}</ShellLine>
            <ShellLine indent={3}>
              <span>{`"ABADGE_API_URL": `}</span>
              <span className="text-[#4f7df7]">"https://api.abadge.io"</span>
              <span>{`,`}</span>
            </ShellLine>
            <ShellLine indent={3}>
              <span>{`"ABADGE_AGENT_ID": `}</span>
              <span className="text-[#4f7df7]">"agent_..."</span>
              <span>{`,`}</span>
            </ShellLine>
            <ShellLine indent={3}>
              <span>{`"ABADGE_PRIVATE_KEY_PATH": `}</span>
              <span className="text-[#4f7df7]">"~/.abadge/agents/mcp.ed25519.jwk"</span>
              <span>{` }`}</span>
            </ShellLine>
            <ShellLine indent={1}>{`}`}</ShellLine>
            <ShellLine>{`}`}</ShellLine>
          </>
        ),
      },
    ],
  },
  {
    id: "sdk",
    label: "SDK",
    chrome: "@abadge/sdk · TypeScript",
    footnote: (
      <Footnote>
        <span className="flex flex-col">
          <span>Human sessions manage control-plane calls.</span>
          <span>Local and remote agents use short-lived abs_ sessions.</span>
          <span>Agents use short-lived abs_ sessions with Ed25519 keypair auth.</span>
        </span>
      </Footnote>
    ),
    sections: [
      {
        accent: true,
        label: "Install",
        detail: "npm package",
        detailTone: "blue",
        content: (
          <CopyCommandLine command={`npm install @abadge/sdk`}>
            <span className="font-semibold text-[#111827]">npm install</span>
            <span> </span>
            <span className="text-[#4f7df7]">@abadge/sdk</span>
          </CopyCommandLine>
        ),
      },
      {
        label: "agent-access.ts",
        detail: "typed client",
        detailTone: "slate",
        content: (
          <>
            <ShellLine>
              <span className="text-[#111827]">import </span>
              <span>{`{ AbadgeAgentClient }`}</span>
              <span> from </span>
              <span className="text-[#4f7df7]">"@abadge/sdk"</span>
              <span>;</span>
            </ShellLine>
            <ShellLine>
              <span className="text-[#111827]">const agent = new AbadgeAgentClient</span>
              <span>{`({`}</span>
            </ShellLine>
            <ShellLine indent={1}>
              <span>{`apiUrl: `}</span>
              <span className="text-[#4f7df7]">"https://api.abadge.io"</span>
              <span>{`,`}</span>
            </ShellLine>
            <ShellLine indent={1}>
              <span>{`agentId: `}</span>
              <span className="text-[#4f7df7]">"agent_..."</span>
              <span>{`,`}</span>
            </ShellLine>
            <ShellLine indent={1}>
              <span>{`privateKey: `}</span>
              <span className="text-[#4f7df7]">ed25519PrivateKey</span>
              <span>{`,`}</span>
            </ShellLine>
            <ShellLine>{`});`}</ShellLine>
            <ShellLine>
              <span className="text-[#111827]">await agent.</span>
              <span className="text-[#4f7df7]">connect</span>
              <span>{`();`}</span>
            </ShellLine>
            <ShellLine>
              <span className="text-[#111827]">const mount = await agent.</span>
              <span className="text-[#4f7df7]">accessMount</span>
              <span>{`(`}</span>
            </ShellLine>
            <ShellLine indent={1}>{`itemId,`}</ShellLine>
            <ShellLine indent={1}>
              <span className="text-[#4f7df7]">"env"</span>
            </ShellLine>
            <ShellLine>{`);`}</ShellLine>
            <ShellLine tone="muted">
              keypair session auto-refreshes; returns blobs for local injection
            </ShellLine>
          </>
        ),
      },
    ],
  },
  {
    id: "api",
    label: "API",
    chrome: "REST v1 · access.mount",
    footnote: <Footnote>audit: access.mount_env (allowed | denied | expired)</Footnote>,
    sections: [
      {
        accent: true,
        label: "Request",
        detail: "POST /v1/access/mount",
        detailTone: "slate",
        content: (
          <>
            <CopyCommandLine
              command={`curl -sS https://api.abadge.io/v1/access/mount \\
  -H "Authorization: Bearer abs_*******" \\
  -H "Content-Type: application/json" \\
  -d '{"itemId":"3f02c7c4-...","mountType":"env"}'`}
            >
              <span className="font-semibold text-[#111827]">curl -sS</span>
              <span> https://api.abadge.io/v1/access/mount \</span>
            </CopyCommandLine>
            <ShellLine indent={1}>
              <span>-H "Authorization: </span>
              <span className="text-[#4f7df7]">Bearer abs_*******</span>
              <span>" \</span>
            </ShellLine>
            <ShellLine indent={1}>{`-H "Content-Type: application/json" \\`}</ShellLine>
            <ShellLine indent={1}>{`-d '{"itemId":"3f02c7c4-...","mountType":"env"}'`}</ShellLine>
          </>
        ),
      },
      {
        label: "Response",
        detail: "zero_knowledge",
        detailTone: "green",
        content: (
          <>
            <ShellLine tone="success">HTTP/1.1 200 OK</ShellLine>
            <ShellLine>{`{`}</ShellLine>
            <ShellLine indent={1}>
              <span>{`"storageMode": `}</span>
              <span className="text-[#4f7df7]">"zero_knowledge"</span>
              <span>,</span>
            </ShellLine>
            <ShellLine indent={1}>
              <span>{`"encryptedItemKey": `}</span>
              <span className="text-[#4f7df7]">"ek_v1_h7Q2mL9a..."</span>
              <span>,</span>
            </ShellLine>
            <ShellLine indent={1}>
              <span>{`"ciphertext": `}</span>
              <span className="text-[#4f7df7]">"ct_v1_Qk2aBmdv..."</span>
              <span>,</span>
            </ShellLine>
            <ShellLine indent={1}>{`"cryptoVersion": 1`}</ShellLine>
            <ShellLine>{`}`}</ShellLine>
          </>
        ),
      },
    ],
  },
];

export function HeroInterfaceTabs() {
  const [activeView, setActiveView] = useState<ViewId>("cli");
  const active = views.find((view) => view.id === activeView) ?? views[0];

  if (!active) {
    return null;
  }

  return (
    <div className="relative w-full max-w-[46rem]">
      <div className="pointer-events-none absolute -inset-4 rounded-[1.25rem] bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.10),transparent_58%)] blur-3xl" />

      <div className="relative flex h-[34rem] min-w-0 flex-col overflow-hidden rounded-[1rem] border border-[#d7dee8] bg-white/80 text-[#111827] shadow-[0_18px_44px_-24px_rgba(15,23,42,0.10),0_0_20px_-16px_rgba(59,130,246,0.10)] backdrop-blur-[12px] md:h-[40rem] xl:h-[36rem]">
        <div className="border-b border-[#eef2f7] px-6 pb-4 pt-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="h-4 w-4 rounded-full bg-[#f8c8cb]" />
              <span className="h-4 w-4 rounded-full bg-[#f7e3a6]" />
              <span className="h-4 w-4 rounded-full bg-[#c8efd5]" />
            </div>

            <div className="max-w-[10.5rem] truncate text-right text-[12px] font-semibold text-[#4f7df7] [font-family:var(--font-landing-mono)] md:max-w-none md:text-[14px]">
              {active.chrome}
            </div>
          </div>

          <div className="mt-6 flex items-center gap-8 border-b border-[#eef2f7] pb-3 [font-family:var(--font-landing-mono)]">
            {views.map((view) => {
              const isActive = view.id === active.id;

              return (
                <button
                  key={view.id}
                  type="button"
                  onClick={() => setActiveView(view.id)}
                  className={`relative pb-2 text-[13px] font-bold tracking-tight transition-colors md:text-[14px] ${
                    isActive
                      ? "text-[#111827] after:absolute after:right-0 after:bottom-0 after:left-0 after:h-[2px] after:bg-[#111827]"
                      : "text-[#a0a8b6] hover:text-[#111827]"
                  }`}
                >
                  {view.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1 px-6 py-6">
          <div className="flex h-full min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <div className="space-y-4">
                {active.sections.map((section) => (
                  <SurfaceSectionBlock key={`${active.id}-${section.label}`} {...section} />
                ))}
              </div>
            </div>

            <div className="pt-4">{active.footnote}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
