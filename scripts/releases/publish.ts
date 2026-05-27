import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import process from "node:process";
import {
  type GitHubBinaryTarget,
  getReleasePackage,
  type ReleasePackage,
  releasePackages,
  repoRoot,
} from "./registry";

type ParsedArgs = {
  dryRun: boolean;
  outDir?: string;
  packageIds: string[];
};

type CommandOptions = {
  cwd?: string;
  stdout?: "inherit" | "pipe";
  stderr?: "inherit" | "pipe";
};

function getArgValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

function getArgValues(argv: readonly string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === flag && argv[index + 1]) {
      values.push(argv[index + 1]);
      index += 1;
    }
  }
  return values;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  return {
    dryRun: argv.includes("--dry-run"),
    outDir: getArgValue(argv, "--outdir"),
    packageIds: getArgValues(argv, "--package"),
  };
}

async function runCommand(
  command: readonly string[],
  options?: CommandOptions,
): Promise<{ stdout: string; stderr: string }> {
  const proc = Bun.spawn(command, {
    cwd: options?.cwd,
    stdout: options?.stdout ?? "pipe",
    stderr: options?.stderr ?? "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
    proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `Command failed (${exitCode}): ${command.join(" ")}\n${stderr || stdout || "no output"}`,
    );
  }

  return { stdout, stderr };
}

async function readPackageVersion(versionSource: string): Promise<string> {
  const packageJson = JSON.parse(await readFile(resolve(repoRoot, versionSource), "utf8")) as {
    version?: string;
  };

  if (!packageJson.version) {
    throw new Error(`Missing version in ${versionSource}`);
  }

  return packageJson.version;
}

async function hasPendingChangesets(): Promise<boolean> {
  try {
    const files = await readdir(join(repoRoot, ".changeset"));
    return files.some((file) => file.endsWith(".md") && file !== "README.md");
  } catch {
    return false;
  }
}

async function sha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(filePath));
  return hash.digest("hex");
}

export function buildGitHubBinaryTag(target: GitHubBinaryTarget, version: string): string {
  return `${target.tagPrefix}${version}`;
}

export function buildGitHubBinaryTitle(target: GitHubBinaryTarget, version: string): string {
  return `${target.releaseTitle} v${version}`;
}

export function buildGitHubBinaryAssetBaseName(
  target: GitHubBinaryTarget,
  version: string,
  platformId: string,
): string {
  return `${target.assetPrefix}-v${version}-${platformId}`;
}

export function defaultOutDirForPackage(releasePackage: ReleasePackage, version: string): string {
  return join(repoRoot, "dist", "releases", releasePackage.id, version);
}

// §AB-0102 — supply-chain provenance for release binaries.

// The release workflow runs on push to `main`, so the keyless signing
// certificate's identity is this exact workflow path at that ref. Verification
// must pin to it — a regexp over the repo would accept any workflow's cert.
const RELEASE_SIGNER_IDENTITY =
  "https://github.com/punitarani/abadge/.github/workflows/release.yml@refs/heads/main";
const RELEASE_OIDC_ISSUER = "https://token.actions.githubusercontent.com";

/**
 * CycloneDX SBOM of the release's dependency closure. A bun-compiled binary
 * cannot be introspected directly, so syft scans the workspace manifests +
 * lockfile; one SBOM is attached per release.
 */
export function buildSbomCommand(scanDir: string, outputPath: string): string[] {
  return ["syft", "scan", `dir:${scanDir}`, "-o", `cyclonedx-json=${outputPath}`];
}

/**
 * Keyless detached signature (Fulcio/Rekor via GitHub OIDC). The
 * `.cosign.bundle` carries the signature + signing certificate, so verification
 * needs only the bundle and the expected signer identity — no key distribution.
 */
export function buildSignBlobCommand(filePath: string, bundlePath: string): string[] {
  return ["cosign", "sign-blob", "--yes", "--bundle", bundlePath, filePath];
}

/** Documented verification counterpart to {@link buildSignBlobCommand}. */
export function buildVerifyBlobCommand(input: {
  filePath: string;
  bundlePath: string;
  certificateIdentity: string;
  oidcIssuer: string;
}): string[] {
  return [
    "cosign",
    "verify-blob",
    "--bundle",
    input.bundlePath,
    "--certificate-identity",
    input.certificateIdentity,
    "--certificate-oidc-issuer",
    input.oidcIssuer,
    input.filePath,
  ];
}

function buildGitHubBinaryReleaseNotes(
  releasePackage: ReleasePackage,
  target: GitHubBinaryTarget,
  version: string,
): string {
  const lines = [
    buildGitHubBinaryTitle(target, version),
    "",
    `Package: ${releasePackage.packageName}`,
    `Tag: ${buildGitHubBinaryTag(target, version)}`,
    "",
    "Artifacts:",
    ...target.platforms.map((platform) => {
      const assetBaseName = buildGitHubBinaryAssetBaseName(target, version, platform.id);
      return `- ${assetBaseName}.tar.gz`;
    }),
    "- SHA256SUMS",
    `- ${target.assetPrefix}-v${version}.sbom.cdx.json (CycloneDX SBOM)`,
    "- *.cosign.bundle (keyless signature per artifact)",
    "",
    "Install:",
    "curl -fsSL https://raw.githubusercontent.com/punitarani/abadge/main/install.sh | bash",
    "",
    "Verify a download (cosign + GitHub OIDC):",
    buildVerifyBlobCommand({
      filePath: "<artifact>",
      bundlePath: "<artifact>.cosign.bundle",
      certificateIdentity: RELEASE_SIGNER_IDENTITY,
      oidcIssuer: RELEASE_OIDC_ISSUER,
    }).join(" "),
  ];

  return `${lines.join("\n")}\n`;
}

async function releaseExists(currentTag: string): Promise<boolean> {
  try {
    await runCommand(["gh", "release", "view", currentTag], { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
}

async function createGitHubRelease(
  tag: string,
  title: string,
  notes: string,
  assets: readonly string[],
): Promise<void> {
  const notesFile = join(repoRoot, "dist", "releases", `${tag}.notes.txt`);
  await mkdir(join(repoRoot, "dist", "releases"), { recursive: true });
  await writeFile(notesFile, notes);

  await runCommand(
    ["gh", "release", "create", tag, ...assets, "--title", title, "--notes-file", notesFile],
    { cwd: repoRoot, stdout: "inherit", stderr: "inherit" },
  );
}

async function buildGitHubBinaryTarget(
  _releasePackage: ReleasePackage,
  target: GitHubBinaryTarget,
  version: string,
  outDir: string,
  sign: boolean,
): Promise<string[]> {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const assets: string[] = [];
  const checksums: string[] = [];

  for (const command of target.prepareCommands ?? []) {
    await runCommand(command, { cwd: repoRoot, stdout: "inherit", stderr: "inherit" });
  }

  for (const platform of target.platforms) {
    const assetBaseName = buildGitHubBinaryAssetBaseName(target, version, platform.id);
    const stageDir = join(outDir, assetBaseName);
    const compiledBinary = join(outDir, `${assetBaseName}.bin`);
    const archivePath = join(outDir, `${assetBaseName}.tar.gz`);

    await mkdir(stageDir, { recursive: true });

    await runCommand(
      [
        ...target.buildCommand,
        `--target=${platform.bunTarget}`,
        target.entrypoint,
        `--outfile=${compiledBinary}`,
      ],
      { cwd: repoRoot, stdout: "inherit", stderr: "inherit" },
    );

    const stagedBinary = join(stageDir, target.binaryName);
    await copyFile(compiledBinary, stagedBinary);
    await chmod(stagedBinary, 0o755);

    await runCommand(["tar", "-czf", archivePath, "-C", outDir, assetBaseName], {
      cwd: repoRoot,
      stdout: "inherit",
      stderr: "inherit",
    });

    await rm(stageDir, { recursive: true, force: true });
    await rm(compiledBinary, { force: true });

    const checksum = await sha256(archivePath);
    checksums.push(`${checksum}  ${basename(archivePath)}`);
    assets.push(archivePath);
  }

  if (sign) {
    // One SBOM per release (the dependency closure is platform-independent).
    // Generated before SHA256SUMS so the checksum file covers it too.
    const sbomPath = join(outDir, `${target.assetPrefix}-v${version}.sbom.cdx.json`);
    await runCommand(buildSbomCommand(repoRoot, sbomPath), {
      cwd: repoRoot,
      stdout: "inherit",
      stderr: "inherit",
    });
    checksums.push(`${await sha256(sbomPath)}  ${basename(sbomPath)}`);
    assets.push(sbomPath);
  }

  const checksumPath = join(outDir, "SHA256SUMS");
  await writeFile(checksumPath, `${checksums.join("\n")}\n`);
  assets.push(checksumPath);

  if (sign) {
    // Sign every published asset (archives, SBOM, checksums). A signing failure
    // throws from runCommand and fails the release (§AB-0102 acceptance).
    for (const asset of [...assets]) {
      const bundlePath = `${asset}.cosign.bundle`;
      await runCommand(buildSignBlobCommand(asset, bundlePath), {
        cwd: repoRoot,
        stdout: "inherit",
        stderr: "inherit",
      });
      assets.push(bundlePath);
    }
  }

  return assets;
}

function resolvePackageOutDir(
  releasePackage: ReleasePackage,
  version: string,
  explicitOutDir: string | undefined,
  packageCount: number,
): string {
  if (!explicitOutDir) {
    return defaultOutDirForPackage(releasePackage, version);
  }

  return packageCount === 1
    ? resolve(explicitOutDir)
    : join(resolve(explicitOutDir), releasePackage.id, version);
}

function resolveSelectedPackages(packageIds: readonly string[]): ReleasePackage[] {
  return packageIds.length > 0
    ? packageIds.map((packageId) => getReleasePackage(packageId))
    : [...releasePackages];
}

async function publishReleasePackage(
  releasePackage: ReleasePackage,
  options: { dryRun: boolean; outDir?: string; packageCount: number },
): Promise<void> {
  const version = await readPackageVersion(releasePackage.versionSource);

  for (const target of releasePackage.targets) {
    if (target.kind !== "github-binary") {
      throw new Error(`Unsupported release target kind: ${target.kind}`);
    }

    const tag = buildGitHubBinaryTag(target, version);
    const title = buildGitHubBinaryTitle(target, version);
    const packageOutDir = resolvePackageOutDir(
      releasePackage,
      version,
      options.outDir,
      options.packageCount,
    );
    const targetOutDir =
      releasePackage.targets.length === 1 ? packageOutDir : join(packageOutDir, target.id);

    if (!options.dryRun && (await releaseExists(tag))) {
      console.log(`Release ${tag} already exists; skipping ${releasePackage.id}.`);
      continue;
    }

    // Sign + SBOM only on a real publish: keyless signing needs GitHub OIDC and
    // syft/cosign on PATH, neither of which a local dry-run build has.
    const assets = await buildGitHubBinaryTarget(
      releasePackage,
      target,
      version,
      targetOutDir,
      !options.dryRun,
    );

    if (options.dryRun) {
      console.log(
        `Built ${assets.length} release artifacts for ${releasePackage.id} in ${targetOutDir}`,
      );
      continue;
    }

    const notes = buildGitHubBinaryReleaseNotes(releasePackage, target, version);
    await createGitHubRelease(tag, title, notes, assets);
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const selectedPackages = resolveSelectedPackages(options.packageIds);

  if (!options.dryRun && (await hasPendingChangesets())) {
    console.log(
      "Pending changesets found; skipping release publish until the version PR is merged.",
    );
    return;
  }

  for (const releasePackage of selectedPackages) {
    await publishReleasePackage(releasePackage, {
      dryRun: options.dryRun,
      outDir: options.outDir,
      packageCount: selectedPackages.length,
    });
  }
}

if (import.meta.main) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
