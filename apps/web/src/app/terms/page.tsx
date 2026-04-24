import type { Metadata } from "next";

import { LandingFooter, LandingHeader, landingRootClassName } from "@/components/landing";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms governing use of abadge.",
};

export default function TermsPage() {
  return (
    <div className={landingRootClassName}>
      <LandingHeader currentPage="terms" />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight">Terms of Service</h1>
        <p className="mt-2 text-xs text-zinc-500">Last updated: 2026-04-22</p>

        <article className="mt-10 space-y-8 text-sm leading-[1.7] text-zinc-700">
          <section>
            <h2 className="mb-3 text-base font-bold uppercase tracking-[0.12em] text-black">
              1. Service description
            </h2>
            <p>
              abadge is a credential control plane for AI agents. You store secrets in encrypted
              profiles, register agents, grant per-item capabilities, and audit every access. The
              Service is provided on an &ldquo;as is&rdquo; basis.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-bold uppercase tracking-[0.12em] text-black">
              2. Account responsibility
            </h2>
            <p>
              You are responsible for maintaining the confidentiality of your master password and
              any credentials stored in your vault. abadge cannot recover your data if you lose your
              master password — by design, the service never holds your plaintext key material for
              zero-knowledge profiles.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-bold uppercase tracking-[0.12em] text-black">
              3. Acceptable use
            </h2>
            <p>You agree not to use the Service to:</p>
            <ul className="mt-3 space-y-2 pl-4">
              {[
                "Violate any applicable law or regulation.",
                "Store credentials you are not authorized to possess.",
                "Attempt to circumvent the Service's access controls or audit logging.",
                "Interfere with or disrupt the Service or its infrastructure.",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-2 h-1 w-1 shrink-0 bg-zinc-400" />
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-base font-bold uppercase tracking-[0.12em] text-black">
              4. Termination
            </h2>
            <p>
              We may suspend or terminate your account for violation of these terms. You may
              terminate your account at any time via account settings.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-bold uppercase tracking-[0.12em] text-black">
              5. Limitation of liability
            </h2>
            <p>
              The Service is provided without warranty. Our aggregate liability for any claim
              arising out of the Service is limited to the amount you paid for the Service in the 12
              months preceding the claim, or $100 (whichever is greater).
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-bold uppercase tracking-[0.12em] text-black">
              6. Changes
            </h2>
            <p>
              We may update these terms. Continued use of the Service after changes constitutes
              acceptance. We will announce material changes via the product.
            </p>
          </section>

          <p className="border-t border-zinc-100 pt-6 text-xs text-zinc-500">
            Questions? Email{" "}
            <a href="mailto:legal@abadge.io" className="underline hover:text-zinc-800">
              legal@abadge.io
            </a>
            .
          </p>
        </article>
      </main>
      <LandingFooter />
    </div>
  );
}
