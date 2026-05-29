import { defineCollection, defineConfig } from "@content-collections/core";
import { compileMarkdown } from "@content-collections/markdown";
import remarkGfm from "remark-gfm";
import { z } from "zod";

const WORDS_PER_MINUTE = 220;

const posts = defineCollection({
  name: "posts",
  directory: "content/blog",
  // Flat structure only: one `.md` per post, filename = slug. `*` (not `**`)
  // keeps slugs to a single URL segment so they always match the `[slug]`
  // route; a nested path would 404 while still listing in the index.
  include: "*.md",
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    // `YYYY-MM-DD`, and a real calendar date. Validated at parse time so a
    // malformed value fails the build rather than throwing a RangeError in
    // `formatPostDate` (which does `new Date(`${date}T00:00:00Z`)`) at render.
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
      .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "date must be a real date"),
    author: z.string().default("Punit Arani"),
    category: z.string().default("Announcement"),
    seoDescription: z.string().optional(),
    published: z.boolean().default(true),
    // Raw markdown body, populated by the parser. Declared explicitly to
    // opt out of the deprecated implicit-content behavior.
    content: z.string(),
  }),
  transform: async (doc, context) => {
    const html = await compileMarkdown(context, doc, { remarkPlugins: [remarkGfm] });
    const words = doc.content.trim().split(/\s+/).filter(Boolean).length;
    return {
      ...doc,
      html,
      // `_meta.path` is the file path relative to the collection directory,
      // without extension — i.e. the URL slug for `content/blog/<slug>.md`.
      slug: doc._meta.path,
      readingTime: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
    };
  },
});

export default defineConfig({
  content: [posts],
});
