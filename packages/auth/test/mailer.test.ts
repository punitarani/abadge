import { describe, expect, it } from "bun:test";
import type { CloudflareEmailBinding } from "../src/mailer";
import { sendEmail } from "../src/mailer";

type SendEmailArgs = Parameters<CloudflareEmailBinding["send"]>[0];

function makeSendEmailStub() {
  const calls: SendEmailArgs[] = [];
  const binding: CloudflareEmailBinding = {
    send: async (builder) => {
      calls.push(builder);
    },
  };
  return { binding, calls };
}

describe("sendEmail", () => {
  it("invokes env.SEND_EMAIL.send with correct from/to/subject/text", async () => {
    const { binding, calls } = makeSendEmailStub();
    await sendEmail({ SEND_EMAIL: binding }, {
      to: "alice@example.com",
      subject: "Test",
      text: "Hello",
    });

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.to).toBe("alice@example.com");
    expect(call.subject).toBe("Test");
    expect(call.text).toBe("Hello");
    // Default from address — dedicated transactional sender, no longer notifications@.
    expect(call.from).toEqual({ name: "abadge", email: "no-reply@notifications.abadge.io" });
  });

  it("honours ABADGE_EMAIL_FROM / ABADGE_EMAIL_FROM_NAME env overrides", async () => {
    const { binding, calls } = makeSendEmailStub();
    await sendEmail(
      {
        SEND_EMAIL: binding,
        ABADGE_EMAIL_FROM: "security@notifications.abadge.io",
        ABADGE_EMAIL_FROM_NAME: "abadge security",
      },
      { to: "alice@example.com", subject: "Test", text: "Hello" },
    );
    expect(calls[0]!.from).toEqual({
      name: "abadge security",
      email: "security@notifications.abadge.io",
    });
  });

  it("includes html when provided", async () => {
    const { binding, calls } = makeSendEmailStub();
    await sendEmail({ SEND_EMAIL: binding }, {
      to: "bob@example.com",
      subject: "x",
      text: "fallback",
      html: "<p>rich</p>",
    });

    const call = calls[0]!;
    expect(call.text).toBe("fallback");
    expect(call.html).toBe("<p>rich</p>");
  });

  it("omits html key when html is not provided", async () => {
    const { binding, calls } = makeSendEmailStub();
    await sendEmail({ SEND_EMAIL: binding }, {
      to: "carol@example.com",
      subject: "plain only",
      text: "text only",
    });

    expect("html" in calls[0]!).toBe(false);
  });

  it("uses custom from and fromName when provided", async () => {
    const { binding, calls } = makeSendEmailStub();
    await sendEmail({ SEND_EMAIL: binding }, {
      to: "user@example.com",
      from: "custom@notifications.abadge.io",
      fromName: "Custom Sender",
      subject: "Custom from",
      text: "body",
    });

    expect(calls[0]!.from).toEqual({ name: "Custom Sender", email: "custom@notifications.abadge.io" });
  });

  it("uses DEFAULT_FROM_NAME when from is custom but fromName is not provided", async () => {
    const { binding, calls } = makeSendEmailStub();
    await sendEmail({ SEND_EMAIL: binding }, {
      to: "user@example.com",
      from: "custom@notifications.abadge.io",
      subject: "s",
      text: "t",
    });

    expect(calls[0]!.from).toEqual({ name: "abadge", email: "custom@notifications.abadge.io" });
  });

  it("wraps binding errors with a clear message", async () => {
    const failingBinding: CloudflareEmailBinding = {
      send: async () => {
        throw new Error("binding not bound");
      },
    };

    await expect(
      sendEmail({ SEND_EMAIL: failingBinding }, {
        to: "x@y.com",
        subject: "s",
        text: "t",
      }),
    ).rejects.toThrow(/Cloudflare Email Send failed:/);
  });

  it("wraps non-Error binding rejections", async () => {
    const failingBinding: CloudflareEmailBinding = {
      // biome-ignore lint/suspicious/useAwait: intentional non-Error throw for test
      send: async () => {
        // biome-ignore lint/complexity/noUselessThisAlias: not applicable
        throw "string error";
      },
    };

    await expect(
      sendEmail({ SEND_EMAIL: failingBinding }, {
        to: "x@y.com",
        subject: "s",
        text: "t",
      }),
    ).rejects.toThrow(/Cloudflare Email Send failed: string error/);
  });
});
