import type { Metadata } from "next";

import { LandingFooter, LandingHeader, landingRootClassName } from "@/components/landing";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy policy for abadge.",
};

export default function PrivacyPage() {
  return (
    <div className={landingRootClassName}>
      <LandingHeader currentPage="privacy" />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="mt-2 text-xs text-zinc-500">Last updated: 2026-04-22</p>

        <article className="mt-10 space-y-8 text-sm leading-[1.7] text-zinc-700">
          <section>
            <h2 className="mb-3 text-base font-bold uppercase tracking-[0.12em] text-black">
              1. Information we collect
            </h2>
            <p>
              <span className="font-semibold text-black">Account data.</span> Email address, hashed
              password, and OAuth provider identifier (if you sign in via Google or GitHub).
            </p>
            <p className="mt-3">
              <span className="font-semibold text-black">Vault data.</span> The ciphertext of your
              secrets. For zero-knowledge profiles, we never see plaintext — encryption and
              decryption happen client-side. For server-managed profiles, we encrypt plaintext with
              AES-256-GCM; plaintext is only decrypted when you or an authorized agent explicitly
              requests it.
            </p>
            <p className="mt-3">
              <span className="font-semibold text-black">Audit data.</span> A row is written for
              every access attempt (allowed or denied), including timestamp, agent id, item id,
              outcome, and IP address. These rows are immutable and retained as long as your account
              is active.
            </p>
            <p className="mt-3">
              <span className="font-semibold text-black">Telemetry.</span> We collect minimal
              operational telemetry (request counts, latency, error rates) to operate the Service.
              We do not track browsing behavior across the web.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-bold uppercase tracking-[0.12em] text-black">
              2. How we use it
            </h2>
            <p>
              We use account data to authenticate you. We use vault data to fulfill your explicit
              requests. We use audit data for your forensics and our operations. We do not sell,
              rent, or share your data with third parties except as required by law.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-bold uppercase tracking-[0.12em] text-black">
              3. Data security
            </h2>
            <p>
              We encrypt data at rest and in transit. Zero-knowledge profile data is
              cryptographically unreadable to us. We use industry-standard practices to protect our
              infrastructure.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-bold uppercase tracking-[0.12em] text-black">
              4. Your rights
            </h2>
            <p>
              You can export your data, revoke agent credentials, and delete your account at any
              time. Account deletion removes your account data; audit logs tied to a deleted account
              are anonymized within 30 days.
            </p>
          </section>

          <p className="border-t border-zinc-100 pt-6 text-xs text-zinc-500">
            Privacy questions? Email{" "}
            <a href="mailto:privacy@abadge.io" className="underline hover:text-zinc-800">
              privacy@abadge.io
            </a>
            .
          </p>
        </article>
      </main>
      <LandingFooter />
    </div>
  );
}
