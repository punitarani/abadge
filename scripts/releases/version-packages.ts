import process from "node:process";
import {
  getReleasePackageVersions,
  readPendingChangesets,
  validateInitialPatchTrainChangesets,
} from "./changesets";

function runCommand(command: readonly string[]): void {
  const proc = Bun.spawnSync(command, {
    stdout: "inherit",
    stderr: "inherit",
  });

  if (proc.exitCode !== 0) {
    throw new Error(`Command failed (${proc.exitCode}): ${command.join(" ")}`);
  }
}

async function main(): Promise<void> {
  const changesets = await readPendingChangesets();
  const packageVersions = await getReleasePackageVersions();
  const errors = validateInitialPatchTrainChangesets(changesets, packageVersions);

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  runCommand(["bun", "run", "changeset", "version"]);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
