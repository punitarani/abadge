import { ApiClient } from "../client";
import { requireConfig } from "../config";
import { error, errorMessage, json, success } from "../output";

interface UserInfo {
  id: string;
  name: string;
  email: string;
}

export async function whoamiCommand(args: string[]): Promise<void> {
  const jsonOutput = args.includes("--json");
  const config = requireConfig();
  const client = new ApiClient(config);

  try {
    const user = await client.get<UserInfo>("/api/auth/session");
    if (jsonOutput) {
      json(user);
    } else {
      success(`${user.name} <${user.email}>`);
    }
  } catch (err) {
    error(errorMessage(err, "Failed to get session info."));
    process.exit(1);
  }
}
