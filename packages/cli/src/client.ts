import { AbadgeClient } from "@abadge/sdk";
import type { CliConfig } from "./config";

export class ApiClient extends AbadgeClient {
  constructor(config: CliConfig) {
    super({
      apiUrl: config.apiUrl,
      token: config.token,
    });
  }
}
