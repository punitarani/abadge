import { CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Condensed } from "next/font/google";
import Link from "next/link";

const landingSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-landing-sans",
});

const landingMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-landing-mono",
});

const landingCondensed = IBM_Plex_Sans_Condensed({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-landing-condensed",
});

const principles = [
  {
    title: "Store once",
    description: "Store encrypted credentials with metadata, environment, and sensitivity.",
  },
  {
    title: "Grant explicitly",
    description: "Give each agent access only to the credentials it should use.",
  },
  {
    title: "Use safely",
    description: "Inject secrets at runtime, require approval when needed, and log every attempt.",
  },
];

const overviewItems = [
  {
    label: "01.ACCESS_MODE",
    title: "Per-agent access",
    description:
      "No shared master key. No broad vault access. Each agent gets explicit permission per credential.",
  },
  {
    label: "02.POSTURE",
    title: "Non-reveal by default",
    description:
      "Use delivery modes that avoid plaintext by default. Reveal is supported, but it is the exception.",
  },
  {
    label: "03.FLOW_CONTROL",
    title: "Approval flows",
    description: "Require human approval for sensitive access before a secret can be used.",
  },
  {
    label: "04.AUDITABILITY",
    title: "Full audit trail",
    description: "See allowed, denied, pending approval, and expired access attempts in one place.",
  },
];

const heroBlocks = [
  {
    comment: "# store a credential",
    lines: [
      "$ abadge secret create \\",
      "  --name github-token \\",
      "  --type api_key \\",
      "  --value ghp_abc123 \\",
      "  --environment prod",
    ],
  },
  {
    comment: "# grant one agent access",
    lines: ["$ abadge grant create \\", "  --agent agent-01 \\", "  --credential <credential-id>"],
  },
  {
    comment: "# use it at runtime",
    lines: [
      "$ abadge run \\",
      "  --secret github-token \\",
      "  --env-var GITHUB_TOKEN \\",
      "  -- npm run deploy",
    ],
  },
];

const securityChecks = [
  "Encrypted at rest",
  "Hashed keys & sessions",
  "Approval workflows",
  "Delivery mode restrictions",
  "Immutable audit log",
];

export const metadata: Metadata = {
  title: "abadge | Password manager for the agentic era",
  description: "Store credentials once. Grant agents explicit access. Audit every access attempt.",
};

export default function HomePage() {
  return (
    <div
      id="top"
      className={`${landingSans.variable} ${landingMono.variable} min-h-screen bg-white text-black selection:bg-[#0047FF] selection:text-white [font-family:var(--font-landing-sans)]`}
    >
      <header className="sticky top-0 z-30 flex w-full items-center justify-between border-b border-black bg-white px-4 py-2">
        <div className="flex items-center gap-8">
          <span className="text-xl font-bold tracking-[-0.04em]">abadge</span>
          <nav className="hidden items-center gap-6 md:flex">
            <a
              href="#overview"
              className="text-[11px] font-bold uppercase tracking-widest transition-colors hover:text-[#0047FF]"
            >
              Docs
            </a>
            <a
              href="#interfaces"
              className="text-[11px] font-bold uppercase tracking-widest transition-colors hover:text-[#0047FF]"
            >
              CLI
            </a>
            <a
              href="#interfaces"
              className="text-[11px] font-bold uppercase tracking-widest transition-colors hover:text-[#0047FF]"
            >
              API
            </a>
            <a
              href="#security"
              className="text-[11px] font-bold uppercase tracking-widest transition-colors hover:text-[#0047FF]"
            >
              Security
            </a>
          </nav>
        </div>

        <Link
          href="/login"
          className="border border-black bg-black px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.05em] text-white transition-colors hover:border-[#0047FF] hover:bg-[#0047FF]"
        >
          Sign in
        </Link>
      </header>

      <main>
        <section className="grid min-h-[31.25rem] border-b border-black lg:grid-cols-2">
          <div className="flex flex-col justify-center border-black bg-white p-6 lg:border-r lg:p-12">
            <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.28em] text-[#0047FF]">
              Status: Alpha
            </div>
            <h1 className="max-w-[34rem] text-[2.65rem] leading-[0.96] font-bold tracking-[-0.06em] md:text-[4.25rem]">
              Password Manager
              <br />
              for the agentic era
            </h1>
            <p className="mt-4 max-w-md text-sm leading-[1.55] font-medium text-zinc-600 md:text-base">
              Store credentials once.
              <br />
              Grant agents explicit access.
              <br />
              Audit every access attempt.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/register"
                className="border border-black bg-black px-6 py-2.5 text-[11px] font-bold uppercase tracking-[0.05em] text-white transition-colors hover:border-[#0047FF] hover:bg-[#0047FF]"
              >
                Get started
              </Link>
              <a
                href="#overview"
                className="border border-black bg-white px-6 py-2.5 text-[11px] font-bold uppercase tracking-[0.05em] text-black transition-colors hover:border-[#0047FF] hover:bg-zinc-100"
              >
                Read docs
              </a>
            </div>

            <div className="mt-12 flex flex-wrap gap-2">
              {["CLI", "API", "MCP", "Approvals", "Audit Log"].map((tag) => (
                <span
                  key={tag}
                  className="border border-black bg-zinc-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-500"
                >
                  {tag}
                </span>
              ))}
            </div>

            <p className="mt-4 text-[10px] font-medium text-zinc-400">
              Encrypted at rest. Non-reveal by default. Plaintext only when explicitly requested.
            </p>
          </div>

          <div className="flex items-center justify-center bg-zinc-50 p-6 lg:p-12">
            <div className="w-full max-w-[36rem] border border-black bg-white p-4 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
              <div className="mb-4 flex items-center justify-between border-b border-zinc-100 pb-2">
                <span className="text-[9px] font-bold uppercase tracking-[0.3em] text-zinc-400">
                  shell — abadge cli
                </span>
                <div className="flex gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-zinc-200" />
                  <span className="h-1.5 w-1.5 rounded-full bg-zinc-200" />
                  <span className="h-1.5 w-1.5 rounded-full bg-zinc-200" />
                </div>
              </div>

              <div className="[font-family:var(--font-landing-mono)] text-[11px] leading-[1.35] md:text-[12px]">
                {heroBlocks.map((block) => (
                  <div key={block.comment} className="mb-4 last:mb-0">
                    <div className="mb-1 text-zinc-400">{block.comment}</div>
                    {block.lines.map((line, index) => (
                      <div
                        key={`${block.comment}-${line}`}
                        className={index === 0 ? "text-black" : "pl-4 text-zinc-600"}
                      >
                        {index === 0 ? (
                          <>
                            <span className="font-bold text-[#0047FF]">$</span>
                            <span>{line.slice(1)}</span>
                          </>
                        ) : (
                          line
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="grid border-b border-black md:grid-cols-3">
          {principles.map((item, index) => (
            <div
              key={item.title}
              className={`bg-white p-6 transition-colors hover:bg-zinc-50 md:p-8 ${
                index < principles.length - 1
                  ? "border-b border-black md:border-r md:border-b-0"
                  : ""
              }`}
            >
              <h2 className="mb-2 text-sm font-bold uppercase tracking-[0.2em]">{item.title}</h2>
              <p className="max-w-sm text-xs leading-[1.6] text-zinc-600">{item.description}</p>
            </div>
          ))}
        </section>

        <section id="overview" className="border-b border-black bg-white p-6 md:p-12">
          <div className="mb-10 md:mb-14">
            <h2
              className={`${landingCondensed.variable} max-w-5xl text-[3.3rem] leading-[0.88] font-bold uppercase tracking-[-0.06em] [font-family:var(--font-landing-condensed)] md:text-[5.25rem] lg:text-[6.25rem]`}
            >
              Credential access control
              <br />
              for <span className="text-[#0047FF]">agents</span>
            </h2>
          </div>

          <div className="grid border border-black md:grid-cols-2">
            {overviewItems.map((item, index) => (
              <div
                key={item.label}
                className={`flex min-h-[15rem] flex-col justify-start bg-white p-8 transition-colors hover:bg-zinc-50 md:min-h-[17rem] md:p-12 ${
                  index % 2 === 0 ? "md:border-r md:border-black" : ""
                } ${index < 2 ? "border-b border-black" : ""}`}
              >
                <div
                  className={`${landingCondensed.variable} mb-8 text-[1.9rem] leading-none font-bold text-[#0047FF] [font-family:var(--font-landing-condensed)] md:text-[2.3rem]`}
                >
                  {item.label.split(".")[0]}
                </div>
                <h3
                  className={`${landingCondensed.variable} mb-4 max-w-[24rem] text-[2rem] leading-[0.92] font-bold uppercase tracking-[-0.04em] [font-family:var(--font-landing-condensed)] md:text-[3rem]`}
                >
                  {item.title}
                </h3>
                <p className="max-w-[28rem] [font-family:var(--font-landing-mono)] text-sm leading-[1.65] text-zinc-500 md:text-[1.05rem]">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section id="interfaces" className="border-b border-black bg-zinc-50">
          <div className="grid lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
            <div className="min-w-0 p-6 lg:p-12">
              <h2 className="max-w-[16rem] text-[1.7rem] leading-[1] font-bold tracking-[-0.04em] sm:max-w-xs md:text-[2.3rem] lg:max-w-md lg:text-[3rem]">
                Use it from the CLI, API, or MCP
              </h2>
              <p className="mt-4 max-w-[16rem] text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400 sm:max-w-xs md:max-w-sm">
                One access model across local tooling, backend workflows, and agent runtimes.
              </p>
            </div>

            <div className="min-w-0 p-6 pt-0 lg:p-12 lg:pt-12">
              <div className="w-full max-w-full overflow-hidden border border-black bg-white">
                <div className="flex overflow-x-auto border-b border-black">
                  <span className="relative shrink-0 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-black md:px-6">
                    CLI
                    <span className="absolute inset-x-0 bottom-0 h-px bg-[#0047FF]" />
                  </span>
                  <span className="shrink-0 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-zinc-400 md:px-6">
                    API
                  </span>
                  <span className="shrink-0 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-zinc-400 md:px-6">
                    MCP
                  </span>
                </div>

                <div className="bg-zinc-50/50 p-4">
                  <pre className="max-w-full overflow-x-auto whitespace-pre [font-family:var(--font-landing-mono)] text-[11px] leading-[1.65] md:text-[12px]">
                    <span className="text-[#0047FF]"># CLI implementation</span>
                    {"\n"}
                    <span className="font-bold text-black">
                      abadge run --secret github-token --env-var GITHUB_TOKEN -- npm run deploy
                    </span>
                    {"\n"}
                    <span className="text-[#0047FF]"># API implementation</span>
                    {"\n"}
                    <span className="font-bold text-black">
                      {`curl -X POST https://api.abadge.io/v1/credentials/access \\
  -H "Authorization: Bearer abd_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "credentialName": "github-token",
    "deliveryMode": "reveal",
    "purpose": "deploy release"
  }'`}
                    </span>
                    {"\n"}
                    <span className="text-[#0047FF]"># MCP integration</span>
                    {"\n"}
                    <span className="font-bold text-black">
                      {`{
  "tool": "run_with_secret",
  "input": {
    "credentialName": "github-token",
    "command": "npm",
    "args": ["run", "deploy"],
    "envVarName": "GITHUB_TOKEN",
    "purpose": "deploy release"
  }
}`}
                    </span>
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="security" className="grid border-b border-black lg:grid-cols-2">
          <div className="border-black bg-white p-6 lg:border-r lg:p-12">
            <h2 className="max-w-lg text-[2.2rem] leading-[0.96] font-bold tracking-[-0.05em] md:text-[3.5rem]">
              Built for agents, not browser autofill
            </h2>
            <p className="mt-6 max-w-xl text-sm leading-[1.6] font-medium text-zinc-600">
              Traditional password managers were built for humans clicking forms. abadge is built
              for agents running code, calling APIs, using tools, and needing controlled access to
              credentials at runtime.
            </p>

            <div className="mt-8 space-y-3">
              {[
                "Explicit per-agent grants",
                "Policy-aware access checks",
                "Audit on every attempt",
              ].map((item) => (
                <div key={item} className="flex items-center gap-3">
                  <span className="h-1.5 w-1.5 bg-[#0047FF]" />
                  <span className="text-[11px] font-bold uppercase tracking-widest">{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-center bg-zinc-100 p-6 lg:p-12">
            <div className="w-full max-w-sm border border-black bg-white p-8">
              <div className="mb-6 text-center text-[9px] font-bold uppercase tracking-[0.4em] text-zinc-400">
                Security Protocol Overview
              </div>
              <div className="space-y-4 border-t border-zinc-100 pt-6">
                {securityChecks.map((item) => (
                  <div key={item} className="flex items-center justify-between gap-4">
                    <span className="text-[10px] font-bold uppercase tracking-[0.12em]">
                      {item}
                    </span>
                    <CheckCircle2 className="h-4 w-4 text-[#0047FF]" strokeWidth={1.8} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-black bg-zinc-50 px-6 py-16 text-center md:px-12 md:py-24">
          <h2 className="text-[2.7rem] leading-[0.95] font-bold tracking-[-0.06em] md:text-[4.5rem]">
            Give agents access.
            <br />
            <span className="text-zinc-400">Not your whole vault.</span>
          </h2>
          <p className="mx-auto mt-6 max-w-md text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
            Store credentials once, grant access intentionally, and keep every attempt attributable.
          </p>

          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Link
              href="/register"
              className="border border-black bg-black px-10 py-3 text-[11px] font-bold uppercase tracking-[0.05em] text-white transition-colors hover:border-[#0047FF] hover:bg-[#0047FF]"
            >
              Start building
            </Link>
            <a
              href="#interfaces"
              className="border border-black bg-white px-10 py-3 text-[11px] font-bold uppercase tracking-[0.05em] text-black transition-colors hover:border-[#0047FF] hover:bg-zinc-100"
            >
              View API docs
            </a>
          </div>
        </section>
      </main>

      <footer className="bg-white p-8">
        <div className="mx-auto flex max-w-[96rem] flex-col justify-between gap-12 md:flex-row md:items-start">
          <div className="max-w-xs">
            <span className="mb-1 block text-xl font-bold tracking-[-0.04em]">abadge</span>
            <span className="mb-4 block text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-400">
              Password manager for the agentic era
            </span>
            <span className="[font-family:var(--font-landing-mono)] text-[9px] text-zinc-300">
              {"SYSTEM_ID: ABADGE_V1.0.4 // © 2024"}
            </span>
          </div>

          <div className="flex gap-12 text-[10px] font-bold uppercase tracking-widest">
            <div className="flex flex-col gap-2">
              <a href="#overview" className="transition-colors hover:text-[#0047FF]">
                Docs
              </a>
              <a href="#interfaces" className="transition-colors hover:text-[#0047FF]">
                CLI
              </a>
              <a href="#interfaces" className="transition-colors hover:text-[#0047FF]">
                API
              </a>
              <a href="#security" className="transition-colors hover:text-[#0047FF]">
                Security
              </a>
            </div>
            <div className="flex flex-col gap-2">
              <a href="https://github.com" className="transition-colors hover:text-[#0047FF]">
                GitHub
              </a>
              <a href="#top" className="transition-colors hover:text-[#0047FF]">
                Status
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
