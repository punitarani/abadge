import { describe, expect, it } from "bun:test";
import { renderResetPasswordEmail } from "../src/emails/reset-password";
import { renderVerifyEmail } from "../src/emails/verify-email";

describe("email templates", () => {
  it("verify email renders HTML + plaintext containing the link", async () => {
    const url = "https://abadge.io/login?verified=1";
    const { html, text } = await renderVerifyEmail(url);
    expect(html).toContain("<html");
    expect(html).toContain("abadge");
    expect(html.toLowerCase()).toContain("verify");
    expect(html).toContain(url);
    expect(text).toContain(url);
    expect(text.length).toBeGreaterThan(0);
  });

  it("reset password email renders with the reset link", async () => {
    const url = "https://abadge.io/reset-password/tok123";
    const { html, text } = await renderResetPasswordEmail(url);
    expect(html.toLowerCase()).toContain("reset");
    expect(html).toContain(url);
    expect(text).toContain(url);
  });
});
