import { render } from "@react-email/render";
import type { ReactElement } from "react";

export interface RenderedEmail {
  html: string;
  text: string;
}

/**
 * Render a React Email template to the `{ html, text }` pair `sendEmail` expects.
 *
 * `@react-email/render` v2 exposes a `workerd` export condition (the edge
 * `renderToReadableStream` path), so this runs inside the Cloudflare Worker
 * runtime that hosts the API. A plaintext alternative is rendered alongside the
 * HTML so clients that strip HTML still get a readable message.
 */
export async function renderEmail(element: ReactElement): Promise<RenderedEmail> {
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { html, text };
}
