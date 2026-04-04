import { Command } from "commander";
import { ApiClient } from "../client";
import { loadConfig } from "../config";
import { daemonClearOperatorSession, daemonOperatorToken, readOperatorSession } from "../daemon";
import { error, success } from "../output";

export function createLogoutCommand(): Command {
  return new Command("logout")
    .description("Clear the in-memory operator session from the local daemon")
    .action(async () => {
      const config = loadConfig();

      try {
        const currentSession = await daemonOperatorToken();
        const operator = readOperatorSession(currentSession);
        if (config && operator?.authenticated && operator.token) {
          try {
            const client = new ApiClient({
              apiUrl: config.apiUrl,
              token: operator.token,
            });
            await client.logout();
          } catch {
            // Clearing local session is still the primary goal.
          }
        }

        const result = await daemonClearOperatorSession();
        if (!result.ok) {
          throw new Error(result.error ?? "Failed to clear operator session");
        }

        success("Logged out.");
      } catch (logoutError) {
        error(logoutError instanceof Error ? logoutError.message : "Logout failed.");
        process.exit(1);
      }
    });
}
