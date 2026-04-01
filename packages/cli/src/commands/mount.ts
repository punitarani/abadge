import { parseArgs } from "node:util";
import { daemonExecMount } from "../daemon";
import { error, errorMessage, str, success } from "../output";

export async function mountCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      item: { type: "string" },
    },
    strict: false,
  });

  const itemId = str(values.item);
  if (!itemId) {
    error("--item <id> is required.");
    process.exit(1);
  }

  try {
    const res = await daemonExecMount(itemId);
    if (!res.ok) {
      error(res.error ?? "Failed to mount item.");
      process.exit(1);
    }

    const data = res.data as { path?: string } | undefined;
    if (data?.path) {
      success(`Mounted at: ${data.path}`);
    } else {
      success("Item mounted.");
    }
  } catch (err) {
    error(errorMessage(err, "Failed to communicate with daemon."));
    process.exit(1);
  }
}
