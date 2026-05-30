import { allPosts, type Post } from "content-collections";

export type BlogPost = Post;

/** Published posts, newest first (dates are authored as `YYYY-MM-DD`). */
export function getPublishedPosts(): Post[] {
  return [...allPosts].filter((post) => post.published).sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function getPostBySlug(slug: string): Post | undefined {
  return allPosts.find((post) => post.published && post.slug === slug);
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

/** Format an authored `YYYY-MM-DD` date as e.g. `May 29, 2026` (TZ-stable). */
export function formatPostDate(date: string): string {
  return dateFormatter.format(new Date(`${date}T00:00:00Z`));
}
