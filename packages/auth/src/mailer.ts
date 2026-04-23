/**
 * Send an email via Cloudflare MailChannels (HTTP API, no SMTP auth).
 * Workers' MailChannels integration: POST https://api.mailchannels.net/tx/v1/send
 *
 * DNS requirements on abadge.io:
 *   - SPF: `v=spf1 include:relay.mailchannels.net -all`
 *   - DMARC: optional but recommended
 *   - _mailchannels TXT: `v=mc1 cfid=<cloudflare-zone-id>` per MailChannels docs
 */
export interface MailchannelsEmail {
  to: string;
  from?: string; // defaults to notifications@abadge.io
  fromName?: string; // defaults to "abadge"
  subject: string;
  text: string;
  html?: string;
}

const MAILCHANNELS_URL = "https://api.mailchannels.net/tx/v1/send";
const DEFAULT_FROM = "notifications@abadge.io";
const DEFAULT_FROM_NAME = "abadge";

export async function sendEmail(email: MailchannelsEmail): Promise<void> {
  const body = {
    personalizations: [{ to: [{ email: email.to }] }],
    from: { email: email.from ?? DEFAULT_FROM, name: email.fromName ?? DEFAULT_FROM_NAME },
    subject: email.subject,
    content: [
      { type: "text/plain", value: email.text },
      ...(email.html ? [{ type: "text/html", value: email.html }] : []),
    ],
  };
  const res = await fetch(MAILCHANNELS_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`MailChannels send failed: ${res.status} ${text.slice(0, 200)}`);
  }
}
