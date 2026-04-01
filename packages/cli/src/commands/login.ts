import { loadConfig, saveConfig } from "../config";
import { error, success } from "../output";
import { prompt } from "../prompt";

export async function loginCommand(args: string[]): Promise<void> {
  const existing = loadConfig();
  const apiUrl = args.includes("--api-url")
    ? args[args.indexOf("--api-url") + 1]
    : (existing?.apiUrl ?? "https://api.abadge.dev");

  if (!apiUrl) {
    error("Missing --api-url value.");
    process.exit(1);
  }

  const email = await prompt("Email: ");
  const password = await prompt("Password: ", true);

  if (!email || !password) {
    error("Email and password are required.");
    process.exit(1);
  }

  const res = await fetch(`${apiUrl.replace(/\/$/, "")}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    error(`Login failed (${res.status}): ${text || "unknown error"}`);
    process.exit(1);
  }

  const data = (await res.json()) as { token?: string };
  const token = data.token;

  if (!token) {
    error("No token in response. Check API compatibility.");
    process.exit(1);
  }

  saveConfig({ apiUrl, token });
  success("Logged in successfully.");
}
