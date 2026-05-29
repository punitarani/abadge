import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import {
  LandingFooter,
  LandingHeader,
  landingCondensed,
  landingRootClassName,
} from "@/components/landing";
import { formatPostDate, getPublishedPosts } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Engineering notes, security trade-offs, and launch announcements from the team building abadge — the credential control plane for AI agents.",
};

function MetaRow({
  category,
  date,
  readingTime,
}: {
  category: string;
  date: string;
  readingTime: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 [font-family:var(--font-landing-mono)]">
      <span className="text-[#0047FF]">{category}</span>
      <span className="h-1 w-1 shrink-0 bg-zinc-300" />
      <span>{formatPostDate(date)}</span>
      <span className="h-1 w-1 shrink-0 bg-zinc-300" />
      <span>{readingTime} min read</span>
    </div>
  );
}

export default function BlogIndexPage() {
  const posts = getPublishedPosts();
  const [featured, ...rest] = posts;

  return (
    <div className={landingRootClassName}>
      <LandingHeader currentPage="blog" />

      <main>
        {/* ── Hero ── */}
        <section className="border-b border-black bg-white p-6 md:p-12 lg:px-20 lg:py-16">
          <div className="mx-auto max-w-[72rem]">
            <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.28em] text-[#0047FF]">
              Blog
            </div>
            <h1
              className={`${landingCondensed.variable} max-w-3xl text-[2.8rem] leading-[0.9] font-bold uppercase tracking-[-0.05em] [font-family:var(--font-landing-condensed)] md:text-[4.5rem]`}
            >
              Notes from
              <br />
              building abadge.
            </h1>
            <p className="mt-6 max-w-xl text-sm leading-[1.7] font-medium text-zinc-600 md:text-base">
              Engineering decisions, security trade-offs, and honest launch notes on the credential
              control plane for AI agents.
            </p>
          </div>
        </section>

        {!featured ? (
          <section className="bg-white p-6 md:p-12 lg:px-20 lg:py-24">
            <div className="mx-auto max-w-[72rem] text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-400 [font-family:var(--font-landing-mono)]">
              No posts yet.
            </div>
          </section>
        ) : (
          <>
            {/* ── Featured (latest) ── */}
            <section className="border-b border-black bg-zinc-50 p-6 md:p-12 lg:px-20 lg:py-16">
              <div className="mx-auto max-w-[72rem]">
                <Link
                  href={`/blog/${featured.slug}`}
                  className="group block border border-black bg-white p-8 transition-colors hover:border-[#0047FF] md:p-12"
                >
                  <MetaRow
                    category={featured.category}
                    date={featured.date}
                    readingTime={featured.readingTime}
                  />
                  <h2 className="mt-5 max-w-3xl text-[1.9rem] leading-[1.02] font-bold tracking-[-0.04em] text-black transition-colors group-hover:text-[#0047FF] md:text-[2.9rem]">
                    {featured.title}
                  </h2>
                  <p className="mt-5 max-w-2xl text-sm leading-[1.7] text-zinc-600 md:text-base">
                    {featured.summary}
                  </p>
                  <div className="mt-8 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-black">
                    Read post
                    <ArrowUpRight
                      className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                      strokeWidth={2}
                    />
                  </div>
                </Link>
              </div>
            </section>

            {/* ── Archive (older posts) ── */}
            {rest.length > 0 && (
              <section className="bg-white p-6 md:p-12 lg:px-20 lg:py-16">
                <div className="mx-auto max-w-[72rem]">
                  <div className="mb-8 text-[10px] font-bold uppercase tracking-[0.28em] text-zinc-400">
                    More posts
                  </div>
                  <div className="border-t border-black">
                    {rest.map((post) => (
                      <Link
                        key={post.slug}
                        href={`/blog/${post.slug}`}
                        className="group flex flex-col gap-3 border-b border-black py-7 transition-colors hover:bg-zinc-50 md:flex-row md:items-baseline md:justify-between md:gap-12"
                      >
                        <div className="min-w-0 md:max-w-3xl">
                          <h3 className="text-lg font-bold tracking-[-0.02em] text-black transition-colors group-hover:text-[#0047FF] md:text-xl">
                            {post.title}
                          </h3>
                          <p className="mt-2 text-sm leading-[1.6] text-zinc-600">{post.summary}</p>
                        </div>
                        <div className="shrink-0 md:pt-1">
                          <MetaRow
                            category={post.category}
                            date={post.date}
                            readingTime={post.readingTime}
                          />
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              </section>
            )}
          </>
        )}
      </main>

      <LandingFooter />
    </div>
  );
}
