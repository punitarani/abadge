import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { saveConfig } from "../config";
import { error, str, success } from "../output";

export async function loginCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      url: { type: "string" },
    },
    strict: false,
  });

  const urlFlag = str(values.url);

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const apiUrl =
      urlFlag ??
      ((await rl.question("API URL [http://localhost:8787]: ")) || "http://localhost:8787");
    const email = await rl.question("Email: ");
    const password = await rl.question("Password: ");

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
      error(`Login failed (${res.status}). Check your credentials.`);
      process.exit(1);
    }

    const data = (await res.json()) as { token?: string };
    const token = data.token ?? extractBearerFromCookies(res);

    if (!token) {
      error("No token received. The API may not support CLI login yet.");
      process.exit(1);
    }

    saveConfig({ apiUrl, token });
    success("Logged in successfully.");
  } finally {
    rl.close();
  }
}

function extractBearerFromCookies(res: Response): string | undefined {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) return undefined;
  const match = setCookie.match(/better-auth\.session_token=([^;]+)/);
  return match?.[1];
}
