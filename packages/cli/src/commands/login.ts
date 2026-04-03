import { Command } from "commander";
import { loadConfig, saveConfig } from "../config";
import { error, success } from "../output";
import { prompt } from "../prompt";

export function createLoginCommand(): Command {
  return new Command("login")
    .description("Authenticate with abadge")
    .option("--api-url <url>", "API base URL")
    .option("--email <email>", "Email address")
    .option("--password <password>", "Password")
    .action(async (opts: { apiUrl?: string; email?: string; password?: string }) => {
      const existing = loadConfig();
      const apiUrl = opts.apiUrl ?? existing?.apiUrl ?? "https://api.abadge.dev";

      const email = opts.email ?? (await prompt("Email: "));
      const password = opts.password ?? (await prompt("Password: ", true));

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
    });
}
