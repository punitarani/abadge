import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { sendEmail } from "../src/mailer";

const MAILCHANNELS_URL = "https://api.mailchannels.net/tx/v1/send";

describe("sendEmail", () => {
  afterEach(() => {
    // Restore any spies after each test
  });

  it("POSTs the correct body shape to the MailChannels URL", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      expect(url).toBe(MAILCHANNELS_URL);
      return new Response(null, { status: 202 });
    });

    await sendEmail({
      to: "user@example.com",
      subject: "Test subject",
      text: "Plain text body",
      html: "<p>HTML body</p>",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(MAILCHANNELS_URL);
    expect(calledInit.method).toBe("POST");
    expect(calledInit.headers).toMatchObject({ "content-type": "application/json" });

    const parsed = JSON.parse(calledInit.body as string);
    expect(parsed.personalizations).toEqual([{ to: [{ email: "user@example.com" }] }]);
    expect(parsed.from).toEqual({ email: "notifications@abadge.io", name: "abadge" });
    expect(parsed.subject).toBe("Test subject");
    expect(parsed.content).toContainEqual({ type: "text/plain", value: "Plain text body" });
    expect(parsed.content).toContainEqual({ type: "text/html", value: "<p>HTML body</p>" });

    fetchSpy.mockRestore();
  });

  it("omits HTML content when html is not provided", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(null, { status: 202 });
    });

    await sendEmail({
      to: "user@example.com",
      subject: "No HTML",
      text: "Plain only",
    });

    const [, calledInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const parsed = JSON.parse(calledInit.body as string);
    expect(parsed.content).toHaveLength(1);
    expect(parsed.content[0]).toEqual({ type: "text/plain", value: "Plain only" });

    fetchSpy.mockRestore();
  });

  it("uses custom from/fromName when provided", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(null, { status: 200 });
    });

    await sendEmail({
      to: "user@example.com",
      from: "custom@abadge.io",
      fromName: "Custom Sender",
      subject: "Custom from",
      text: "body",
    });

    const [, calledInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const parsed = JSON.parse(calledInit.body as string);
    expect(parsed.from).toEqual({ email: "custom@abadge.io", name: "Custom Sender" });

    fetchSpy.mockRestore();
  });

  it("throws on non-2xx response", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response("Bad Request", { status: 400 });
    });

    await expect(
      sendEmail({ to: "user@example.com", subject: "Fail", text: "body" }),
    ).rejects.toThrow("MailChannels send failed: 400");

    fetchSpy.mockRestore();
  });

  it("throws with truncated body on non-2xx response", async () => {
    const longBody = "x".repeat(300);
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(longBody, { status: 500 });
    });

    await expect(
      sendEmail({ to: "user@example.com", subject: "Fail", text: "body" }),
    ).rejects.toThrow("MailChannels send failed: 500");

    // Error message body is capped at 200 chars
    try {
      await sendEmail({ to: "user@example.com", subject: "Fail2", text: "body" });
    } catch (err) {
      expect((err as Error).message.length).toBeLessThanOrEqual(
        "MailChannels send failed: 500 ".length + 200,
      );
    }

    fetchSpy.mockRestore();
  });
});
