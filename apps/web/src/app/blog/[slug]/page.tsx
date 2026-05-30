import { ArrowLeft, ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  LandingFooter,
  LandingHeader,
  landingCondensed,
  landingRootClassName,
} from "@/components/landing";
import { formatPostDate, getPostBySlug, getPublishedPosts } from "@/lib/blog";

// Static blog: only generated slugs are valid; anything else is a 404.
export const dynamicParams = false;

type PageProps = { params: Promise<{ slug: string }> };

export function generateStaticParams(): { slug: string }[] {
  return getPublishedPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) {
    return { title: "Post not found" };
  }
  const description = post.seoDescription ?? post.summary;
  return {
    title: post.title,
    description,
    openGraph: {
      title: post.title,
      description,
      type: "article",
      publishedTime: post.date,
      authors: [post.author],
    },
    twitter: { card: "summary_large_image", title: post.title, description },
  };
}

export default async function BlogPostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) {
    notFound();
  }

  return (
    <div className={landingRootClassName}>
      <LandingHeader currentPage="blog" />

      <main>
        <article>
          {/* ── Post header ── */}
          <header className="border-b border-black bg-white px-6 py-12 md:px-12 md:py-16 lg:py-20">
            <div className="mx-auto max-w-[44rem]">
              <Link
                href="/blog"
                className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 transition-colors hover:text-[#0047FF] [font-family:var(--font-landing-mono)]"
              >
                <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
                All posts
              </Link>

              <div className="mt-8 text-[10px] font-bold uppercase tracking-[0.28em] text-[#0047FF]">
                {post.category}
              </div>
              <h1 className="mt-4 text-[2.1rem] leading-[1.04] font-bold tracking-[-0.045em] text-black md:text-[3.2rem]">
                {post.title}
              </h1>
              <p className="mt-5 text-base leading-[1.6] text-zinc-600 md:text-lg">
                {post.summary}
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-2.5 border-t border-zinc-200 pt-6 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 [font-family:var(--font-landing-mono)]">
                <span className="text-black">{post.author}</span>
                <span className="h-1 w-1 bg-zinc-300" />
                <span>{formatPostDate(post.date)}</span>
                <span className="h-1 w-1 bg-zinc-300" />
                <span>{post.readingTime} min read</span>
              </div>
            </div>
          </header>

          {/* ── Post body ── */}
          <div className="bg-white px-6 py-12 md:px-12 md:py-16">
            <div
              className="blog-prose mx-auto max-w-[44rem]"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: first-party markdown compiled to HTML at build time by content-collections
              dangerouslySetInnerHTML={{ __html: post.html }}
            />
          </div>
        </article>

        {/* ── CTA ── */}
        <section className="border-y border-black bg-[#1148F5] px-6 py-16 text-center text-white md:px-12 md:py-20">
          <h2
            className={`${landingCondensed.variable} mx-auto max-w-3xl text-[2.4rem] leading-[0.92] font-bold tracking-[-0.04em] [font-family:var(--font-landing-condensed)] md:text-[3.6rem]`}
          >
            Give agents access.
            <br />
            Not your entire vault.
          </h2>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Link
              href="/register"
              className="min-w-[14rem] border border-white bg-white px-8 py-3.5 text-center text-[11px] font-bold uppercase tracking-[0.08em] text-[#1148F5] transition-colors hover:bg-[#EAF0FF]"
            >
              Get started
            </Link>
            <a
              href="https://github.com/punitarani/abadge"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-w-[14rem] items-center justify-center gap-2 border border-white bg-transparent px-8 py-3.5 text-center text-[11px] font-bold uppercase tracking-[0.08em] text-white transition-colors hover:bg-[#2B5BFF]"
            >
              View source
              <ArrowUpRight className="h-4 w-4" strokeWidth={2} />
            </a>
          </div>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
}
