import process from "node:process";
import {
  getReleasePackageVersions,
  isChangesetFile,
  readPendingChangesets,
  validateInitialPatchTrainChangesets,
} from "./changesets";
import { getImpactedReleasePackages } from "./registry";

function getArgValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

function runGit(command: readonly string[]): string {
  const proc = Bun.spawnSync(command, {
    stdout: "pipe",
    stderr: "pipe",
  });
  const decoder = new TextDecoder();

  if (proc.exitCode !== 0) {
    throw new Error(
      `Command failed (${proc.exitCode}): ${command.join(" ")}\n${decoder.decode(proc.stderr)}`,
    );
  }

  return decoder.decode(proc.stdout);
}

function getChangedFiles(baseRef: string): string[] {
  runGit(["git", "fetch", "origin", baseRef, "--depth=1"]);

  return runGit(["git", "diff", "--name-only", `origin/${baseRef}...HEAD`])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function getChangedChangesetFiles(changedFiles: readonly string[]): string[] {
  return changedFiles.filter((file) => isChangesetFile(file));
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const baseRef = getArgValue(argv, "--base-ref");
  if (!baseRef) {
    throw new Error("Missing required --base-ref argument");
  }

  const changedFiles = getChangedFiles(baseRef);
  const impactedPackages = getImpactedReleasePackages(changedFiles);
  const changedChangesetFiles = new Set(getChangedChangesetFiles(changedFiles));

  if (changedChangesetFiles.size > 0) {
    const packageVersions = await getReleasePackageVersions();
    const changedChangesets = (await readPendingChangesets()).filter((changeset) =>
      changedChangesetFiles.has(changeset.path),
    );
    const errors = validateInitialPatchTrainChangesets(changedChangesets, packageVersions);

    if (errors.length > 0) {
      throw new Error(errors.join("\n"));
    }
  }

  if (impactedPackages.length === 0 || changedChangesetFiles.size > 0) {
    return;
  }

  throw new Error(
    `Release-surface changes for ${impactedPackages.map((pkg) => pkg.id).join(", ")} require a changeset in .changeset/*.md`,
  );
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
