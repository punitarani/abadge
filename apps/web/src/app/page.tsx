import { ArrowUpRight, CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Condensed } from "next/font/google";
import Image from "next/image";
import Link from "next/link";

import { HeroInterfaceTabs } from "@/components";

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

const operatingPrinciples = [
  {
    title: "Store or connect",
    description: "Use native encrypted credentials or reference existing secret systems.",
  },
  {
    title: "Grant per agent",
    description:
      "Decide which agent can use which credential, through which delivery mode, and for how long.",
  },
  {
    title: "Enforce before access",
    description:
      "Evaluate policy, require approval, scope the session, and log the outcome before the credential is delivered.",
  },
];

const researchSignals = [
  {
    value: "40%",
    title: "Enterprise apps moving to agents",
    description:
      "Gartner said on August 26, 2025 that 40% of enterprise applications will include task-specific AI agents by the end of 2026, up from less than 5% in 2025.",
    source: "Gartner",
    href: "https://www.gartner.com/en/newsroom/press-releases/2025-08-26-gartner-predicts-40-percent-of-enterprise-apps-will-feature-task-specific-ai-agents-by-2026-up-from-less-than-5-percent-in-2025",
  },
  {
    value: "85%",
    title: "Agents already in production",
    description:
      "Cloud Security Alliance reported on March 24, 2026 that 85% of organizations already use AI agents in production environments.",
    source: "Cloud Security Alliance",
    href: "https://cloudsecurityalliance.org/press-releases/2026/03/24/more-than-two-thirds-of-organizations-cannot-clearly-distinguish-ai-agent-from-human-actions",
  },
  {
    value: "74%",
    title: "Over-privileged access is common",
    description:
      "The same CSA research said 74% of organizations believe agents often receive more access than necessary.",
    source: "Cloud Security Alliance",
    href: "https://cloudsecurityalliance.org/press-releases/2026/03/24/more-than-two-thirds-of-organizations-cannot-clearly-distinguish-ai-agent-from-human-actions",
  },
  {
    value: "OWASP",
    title: "Credential mishandling is already a top LLM risk",
    description:
      "OWASP flags sensitive information disclosure and insecure tool design as leading risks for LLM-powered applications.",
    source: "OWASP Top 10 for LLM Applications",
    href: "https://owasp.org/www-project-top-10-for-large-language-model-applications/",
  },
];

const productTracks = [
  {
    label: "01.ACCESS",
    title: "Control credential use at request time",
    description:
      "Per-agent grants, policy checks, approval workflows, short-lived broker sessions, delivery-mode enforcement, and audit on every attempt.",
  },
  {
    label: "02.CONNECT",
    title: "Store native credentials or reference existing systems",
    description:
      "Use encrypted native storage when needed, or connect secret sources without giving up one policy and audit model.",
  },
  {
    label: "03.INTERFACES",
    title: "Meet agents and developers where they already work",
    description:
      "One control plane across dashboard, REST API, TypeScript SDK, CLI, and MCP, not separate access paths with separate policies.",
  },
];

const interfaceExamples = [
  {
    name: "CLI",
    body: `# store a native credential
$ abadge secret create \\
  --name github-token \\
  --type api_key \\
  --value ghp_abc123 \\
  --environment prod

# grant one agent explicit access
$ abadge grant create \\
  --agent agent-01 \\
  --credential <credential-id> \\
  --delivery-modes env_inject,file_mount

# use it without handing over the vault
$ abadge run \\
  --secret github-token \\
  --env-var GITHUB_TOKEN \\
  -- npm run deploy`,
  },
  {
    name: "SDK",
    body: `const client = new AbadgeClient({ apiUrl, token });

await client.accessCredential({
  credentialName: "github-token",
  deliveryMode: "env_inject",
  purpose: "deploy release",
});`,
  },
  {
    name: "API",
    body: `curl -X POST https://api.abadge.io/v1/credentials/access \\
  -H "Authorization: Bearer abg_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "credentialName": "github-token",
    "deliveryMode": "reveal",
    "purpose": "deploy release"
  }'`,
  },
  {
    name: "MCP",
    body: `{
  "tool": "run_with_secret",
  "input": {
    "credentialName": "github-token",
    "command": "npm",
    "args": ["run", "deploy"],
    "envVarName": "GITHUB_TOKEN"
  }
}`,
  },
];

const securityChecks = [
  "Encrypted credentials and connector configs",
  "Approval-aware policy evaluation",
  "Non-reveal delivery modes by default",
  "Immutable audit trail for every attempt",
];

const externalSignals = [
  {
    label: "1Password Secure Agentic Autofill",
    href: "https://developer.1password.com/docs/agentic-autofill/",
  },
  {
    label: "1Password Unified Access",
    href: "https://1password.com/press/2026/mar/1password-unified-access",
  },
  {
    label: "Bitwarden Agent Access SDK",
    href: "https://bitwarden.com/blog/introducing-agent-access-sdk/",
  },
];

export const metadata: Metadata = {
  title: "abadge | The credential control plane for AI agents",
  description:
    "Store or connect credentials, grant agents scoped access at request time, require approval for sensitive actions, and audit every attempt.",
};

export default function HomePage() {
  return (
    <div
      id="top"
      className={`${landingSans.variable} ${landingMono.variable} min-h-screen bg-white text-black selection:bg-[#0047FF] selection:text-white [font-family:var(--font-landing-sans)]`}
    >
      <header className="sticky top-0 z-30 flex w-full items-center justify-between border-b border-black bg-white px-4 py-2">
        <Link href="/" className="inline-flex items-center gap-2">
          <Image src="/abadge-logo-black.svg" alt="abadge logo" width={24} height={24} />
          <span className="text-xl font-bold tracking-[-0.04em]">abadge</span>
        </Link>

        <div className="flex items-center gap-3">
          <a
            href="https://docs.abadge.io"
            className="text-[11px] font-bold uppercase tracking-widest transition-colors hover:text-[#0047FF]"
          >
            Docs
          </a>
          <Link
            href="/login"
            className="border border-black bg-black px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.05em] text-white transition-colors hover:border-[#0047FF] hover:bg-[#0047FF]"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main>
        <section className="grid min-h-[32rem] border-b border-black lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <div className="flex flex-col justify-center border-black bg-white p-6 lg:border-r lg:p-12">
            <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.28em] text-[#0047FF]">
              Status: Alpha
            </div>
            <h1 className="max-w-[42rem] text-[2.65rem] leading-[0.93] font-bold tracking-[-0.06em] md:text-[4.55rem]">
              The credential control plane
              <br />
              for AI agents
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-[1.65] font-medium text-zinc-600 md:text-base">
              Store native credentials or connect existing secret systems. Grant agents scoped
              access at request time, require approval for sensitive actions, and keep every attempt
              auditable across API, CLI, SDK, and MCP.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/register"
                className="border border-black bg-black px-6 py-2.5 text-[11px] font-bold uppercase tracking-[0.05em] text-white transition-colors hover:border-[#0047FF] hover:bg-[#0047FF]"
              >
                Get started
              </Link>
              <a
                href="https://docs.abadge.io"
                className="border border-black bg-white px-6 py-2.5 text-[11px] font-bold uppercase tracking-[0.05em] text-black transition-colors hover:border-[#0047FF] hover:bg-zinc-100"
              >
                Read the Docs
              </a>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              {["Access", "Connect", "SDK", "CLI", "API", "MCP", "Approvals", "Audit"].map(
                (tag) => (
                  <span
                    key={tag}
                    className="border border-black bg-zinc-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-500"
                  >
                    {tag}
                  </span>
                ),
              )}
            </div>

            <p className="mt-4 max-w-lg text-[10px] font-medium text-zinc-400">
              Not another shared vault. Abadge is scoped, least-privilege agent access with explicit
              grants, policy checks, approvals, and a full audit trail.
            </p>
          </div>

          <div className="flex items-center justify-center bg-zinc-50 p-6 lg:p-12">
            <HeroInterfaceTabs examples={interfaceExamples} />
          </div>
        </section>

        <section className="grid border-b border-black md:grid-cols-3">
          {operatingPrinciples.map((item, index) => (
            <div
              key={item.title}
              className={`bg-white p-6 transition-colors hover:bg-zinc-50 md:p-8 ${
                index < operatingPrinciples.length - 1
                  ? "border-b border-black md:border-r md:border-b-0"
                  : ""
              }`}
            >
              <h2 className="mb-2 text-sm font-bold uppercase tracking-[0.2em]">{item.title}</h2>
              <p className="max-w-sm text-xs leading-[1.6] text-zinc-600">{item.description}</p>
            </div>
          ))}
        </section>

        <section id="why-now" className="border-b border-black bg-zinc-50 p-6 md:p-12">
          <div className="mb-10 flex flex-col gap-4 md:mb-14 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.28em] text-[#0047FF]">
                Why now
              </div>
              <h2
                className={`${landingCondensed.variable} max-w-4xl text-[2rem] leading-[1] font-bold uppercase tracking-[-0.04em] [font-family:var(--font-landing-condensed)] md:text-[3rem] lg:text-[3.75rem]`}
              >
                Agents are taking action.
                <br />
                Credential access hasn&apos;t caught up.
              </h2>
            </div>
          </div>

          <div className="grid gap-px border border-black bg-black md:grid-cols-2 xl:grid-cols-4">
            {researchSignals.map((item) => (
              <div key={item.title} className="flex flex-col bg-white p-6">
                <div className="text-[2.25rem] leading-none font-bold tracking-[-0.06em] text-[#0047FF]">
                  {item.value}
                </div>
                <h3 className="mt-4 text-sm font-bold uppercase tracking-[0.14em]">{item.title}</h3>
                <p className="mt-3 flex-1 text-sm leading-[1.6] text-zinc-600">
                  {item.description}
                </p>
                <a
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-5 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 transition-colors hover:text-[#0047FF]"
                >
                  {item.source}
                  <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.8} />
                </a>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-col items-start gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500 md:flex-row md:flex-wrap md:items-center md:gap-3">
            <span className="self-center md:self-center">External signals:</span>
            {externalSignals.map((item) => (
              <a
                key={item.label}
                href={item.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-full items-center gap-1 border border-black bg-white px-3 py-1.5 transition-colors hover:border-[#0047FF] hover:text-[#0047FF] md:w-auto"
              >
                {item.label}
                <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.8} />
              </a>
            ))}
          </div>
        </section>

        <section id="scope" className="border-b border-black bg-white p-6 md:p-12">
          <div className="mb-10 md:mb-14">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.28em] text-[#0047FF]">
              Product wedge
            </div>
            <h2
              className={`${landingCondensed.variable} max-w-7xl text-[3.3rem] leading-[0.88] font-bold uppercase tracking-[-0.06em] [font-family:var(--font-landing-condensed)] md:text-[5.25rem] lg:text-[6.25rem]`}
            >
              One control plane.
              <br />
              Three surfaces.
            </h2>
          </div>

          <div className="grid gap-px border border-black bg-black lg:grid-cols-3">
            {productTracks.map((item) => (
              <div key={item.label} className="flex min-h-[18rem] flex-col bg-white p-8 md:p-10">
                <div
                  className={`${landingCondensed.variable} text-[1.9rem] leading-none font-bold text-[#0047FF] [font-family:var(--font-landing-condensed)] md:text-[2.4rem]`}
                >
                  {item.label}
                </div>
                <h3
                  className={`${landingCondensed.variable} mt-7 max-w-[19rem] text-[2rem] leading-[0.92] font-bold uppercase tracking-[-0.04em] [font-family:var(--font-landing-condensed)] md:text-[3rem]`}
                >
                  {item.title}
                </h3>
                <p className="mt-4 max-w-[26rem] [font-family:var(--font-landing-mono)] text-sm leading-[1.7] text-zinc-500 md:text-[1.02rem]">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section
          id="security"
          className="grid border-b border-black lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]"
        >
          <div className="border-black bg-white p-6 lg:border-r lg:p-12">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.28em] text-[#0047FF]">
              Security model
            </div>
            <h2 className="max-w-lg text-[2.2rem] leading-[0.96] font-bold tracking-[-0.05em] md:text-[3.5rem]">
              Let agents work without giving them the whole vault
            </h2>
            <p className="mt-6 max-w-xl text-sm leading-[1.65] font-medium text-zinc-600">
              Traditional secret management assumes a human on the other side. abadge keeps the
              control plane tight: explicit grants, policy-aware access, approval flows,
              delivery-mode restrictions, and audit on every attempt.
            </p>

            <div className="mt-8 space-y-3">
              {[
                "Explicit per-agent grants instead of broad vault access",
                "Approval required for sensitive access when policy demands it",
                "MCP tools that avoid raw secret exposure to the model",
              ].map((item) => (
                <div key={item} className="flex items-center gap-3">
                  <span className="h-1.5 w-1.5 bg-[#0047FF]" />
                  <span className="text-[11px] font-bold uppercase tracking-widest">{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-center bg-zinc-100 p-6 lg:p-12">
            <div className="w-full max-w-[34rem] border border-black bg-white p-8">
              <div className="mb-6 text-center text-[9px] font-bold uppercase tracking-[0.4em] text-zinc-400">
                Guardrails
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

        <section className="border-b border-black bg-[#1148F5] px-6 py-20 text-center text-white md:px-12 md:py-28">
          <h2
            className={`${landingCondensed.variable} mx-auto max-w-5xl text-[3.4rem] leading-[0.9] font-bold tracking-[-0.05em] [font-family:var(--font-landing-condensed)] md:text-[6.6rem]`}
          >
            Give agents access.
            <br />
            <span>Not your entire vault.</span>
          </h2>

          <div className="mt-12 flex flex-wrap justify-center gap-4 md:mt-14">
            <Link
              href="/register"
              className={`${landingCondensed.variable} min-w-[15rem] border border-white bg-white px-10 py-4 text-center text-[1rem] font-bold uppercase tracking-[0.01em] text-[#1148F5] transition-colors hover:bg-[#EAF0FF] [font-family:var(--font-landing-condensed)]`}
            >
              Get started
            </Link>
            <a
              href="https://docs.abadge.io"
              className={`${landingCondensed.variable} min-w-[15rem] border border-white bg-transparent px-10 py-4 text-center text-[1rem] font-bold uppercase tracking-[0.01em] text-white transition-colors hover:bg-[#2B5BFF] [font-family:var(--font-landing-condensed)]`}
            >
              Read the Docs
            </a>
          </div>
        </section>
      </main>

      <footer className="bg-white p-8">
        <div className="mx-auto flex max-w-[96rem] flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="order-2 max-w-xs md:order-1">
            <div className="mb-1 inline-flex items-center gap-2">
              <Image src="/abadge-logo-black.svg" alt="abadge logo" width={24} height={24} />
              <span className="text-xl font-bold tracking-[-0.04em]">abadge</span>
            </div>
            <span className="mb-4 block whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-400">
              Credential control plane for AI agents
            </span>
          </div>

          <div className="order-1 flex items-center gap-6 text-[10px] font-bold uppercase tracking-widest whitespace-nowrap md:order-2">
            <a
              href="https://github.com/punitarani/abadge"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-[#0047FF]"
            >
              GitHub
            </a>
            <a
              href="https://docs.abadge.io"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-[#0047FF]"
            >
              Docs
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
