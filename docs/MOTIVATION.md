# Product Framing

## Positioning

**Abadge is a credential control plane for AI agents.**

It stores native credentials or references existing secret systems, grants agents explicit access
per credential, evaluates policy at request time, supports approval for sensitive access, and
records a complete audit trail across the dashboard, API, CLI, SDK, and MCP server.

This is the product story for v1. Abadge is not trying to win by being a general-purpose password
manager for humans. It wins by making agent credential use attributable, constrained, and
operationally usable.

## Problem

Agents are starting to take real actions in APIs, browsers, internal tools, and customer
environments. Credential handling around those agents is still usually one of four bad patterns:

* secrets hardcoded into code, prompts, or config
* plaintext environment variables shared too broadly
* agents given broad standing access to an entire vault
* agent actions hidden behind shared human or service identities

That is exactly the kind of failure surface current security guidance is warning about. OWASP's Top
10 for LLM applications calls out both sensitive information disclosure and insecure plugin/tool
design as major risks for LLM-powered systems. [OWASP](https://owasp.org/www-project-top-10-for-large-language-model-applications/)

## Why now

The adoption curve is no longer hypothetical:

* On August 26, 2025, Gartner said **40% of enterprise applications** would include
  task-specific AI agents by the end of 2026, up from **less than 5% in 2025**.
  [Gartner](https://www.gartner.com/en/newsroom/press-releases/2025-08-26-gartner-predicts-40-percent-of-enterprise-apps-will-feature-task-specific-ai-agents-by-2026-up-from-less-than-5-percent-in-2025)
* On March 24, 2026, Cloud Security Alliance published survey results showing **85% of
  organizations** already use AI agents in production and **74%** say agents often receive more
  access than necessary.
  [Cloud Security Alliance](https://cloudsecurityalliance.org/press-releases/2026/03/24/more-than-two-thirds-of-organizations-cannot-clearly-distinguish-ai-agent-from-human-actions)
* The vendor response is already underway. 1Password is shipping agent-focused flows such as Secure
  Agentic Autofill and broader Unified Access positioning for AI agent security.
  [1Password Developer](https://developer.1password.com/docs/agentic-autofill/)
  [1Password](https://1password.com/press/2026/mar/1password-unified-access)

The category is forming now. The gap is a developer-first control plane that combines scoped
runtime access, policy checks, approval workflows, connectors, and an interface surface that feels
native to how agent builders already work.

## Who Abadge is for

Abadge is for teams building:

* browser agents that sign in and operate on behalf of users
* workflow agents that call third-party APIs
* internal copilots that need scoped access to company systems
* B2B SaaS products that act on behalf of customer accounts

It is especially useful when an agent needs customer-specific credentials, organization secrets, or
privileged internal access without being handed broad standing permissions.

## Product wedge for v1

Lead with three surfaces:

### 1. Access

Abadge decides whether an agent can use a credential right now, under what delivery mode, and
under which policy.

Current implementation:

* explicit agent-to-credential grants
* policy evaluation at access time
* approval-required flows
* short-lived broker sessions
* delivery mode enforcement
* immutable access logging for allow, deny, and pending approval outcomes

### 2. Connect

Abadge can store native encrypted credentials or reference external secret systems while keeping one
policy and audit model.

Current implementation:

* native encrypted credential storage
* external secret references
* encrypted connector configuration
* broker-side and server-side connectors, depending on connector type

### 3. Interfaces

Abadge should feel like infrastructure, not a special dashboard-only workflow.

Current implementation:

* tRPC as the canonical control plane
* dashboard for operator workflows
* CLI for developer and admin workflows
* TypeScript SDK for programmatic integrations
* MCP tools for agent runtimes

The MCP surface should stay aligned with MCP's authorization model for restricted servers acting on
behalf of resource owners.
[Model Context Protocol](https://modelcontextprotocol.io/specification/draft/basic/authorization)

## What Abadge should not lead with

For v1, do not position Abadge as:

* a generic password manager
* a browser autofill product
* a zero-knowledge vault platform
* an agent orchestration system

Those stories are either too crowded, not supported by the current implementation, or not the sharp
wedge. Native credential storage matters, but it should support the access-control story rather than
replace it.

## Plain statement

Use this sentence when in doubt:

**Abadge lets AI agents use credentials safely.**

More explicit version:

**Abadge is the secure access layer between AI agents and credentials. It stores native secrets or
connects to existing vaults, grants least-privilege access just in time, supports approvals for
sensitive actions, and keeps every access attributable and auditable.**
