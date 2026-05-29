import { defineCollection, defineConfig } from "@content-collections/core";
import { compileMarkdown } from "@content-collections/markdown";
import remarkGfm from "remark-gfm";
import { z } from "zod";

const WORDS_PER_MINUTE = 220;

const posts = defineCollection({
  name: "posts",
  directory: "content/blog",
  include: "**/*.md",
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    date: z.string(),
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
