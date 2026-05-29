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
  /**
   * Optional sender overrides. Default `no-reply@notifications.abadge.io` — a
   * dedicated transactional address on the SPF/DKIM/DMARC-verified
   * `notifications.abadge.io` sending domain. Override only with an address on a
   * domain Cloudflare Email Routing is verified to send from.
   */
  ABADGE_EMAIL_FROM?: string;
  ABADGE_EMAIL_FROM_NAME?: string;
}

const DEFAULT_FROM_EMAIL = "no-reply@notifications.abadge.io";
const DEFAULT_FROM_NAME = "abadge";

export interface MailerEmail {
  to: string;
  from?: string;
  fromName?: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendEmail(env: MailerEnv, email: MailerEmail): Promise<void> {
  // Precedence per field: per-message override → env override → default.
  const from = {
    name: email.fromName ?? env.ABADGE_EMAIL_FROM_NAME ?? DEFAULT_FROM_NAME,
    email: email.from ?? env.ABADGE_EMAIL_FROM ?? DEFAULT_FROM_EMAIL,
  };

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
