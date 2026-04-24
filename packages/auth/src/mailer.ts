/**
 * Send transactional email via Cloudflare Email Workers (send_email binding).
 * The SEND_EMAIL binding is configured in wrangler.jsonc and Cloudflare's
 * Email Routing UI. DNS on notifications.abadge.io provides SPF/DKIM/DMARC.
 *
 * No MIME library needed: the CF runtime's SendEmail.send(builder) overload
 * accepts { from, to, subject, text, html } directly.
 */

// Cloudflare's SendEmail binding interface (matches @cloudflare/workers-types SendEmail).
export interface CloudflareEmailBinding {
  send(builder: {
    from: string | { name: string; email: string };
    to: string | string[];
    subject: string;
    text?: string;
    html?: string;
  }): Promise<unknown>;
}

export interface MailerEnv {
  SEND_EMAIL: CloudflareEmailBinding;
}

const DEFAULT_FROM = { name: "abadge", email: "notifications@notifications.abadge.io" };

export interface MailerEmail {
  to: string;
  from?: string;
  fromName?: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendEmail(env: MailerEnv, email: MailerEmail): Promise<void> {
  const from =
    email.from !== undefined
      ? { name: email.fromName ?? DEFAULT_FROM.name, email: email.from }
      : DEFAULT_FROM;

  try {
    await env.SEND_EMAIL.send({
      from,
      to: email.to,
      subject: email.subject,
      text: email.text,
      ...(email.html !== undefined ? { html: email.html } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Cloudflare Email Send failed: ${message}`);
  }
}
