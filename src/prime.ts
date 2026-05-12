import * as path from "node:path";
import type { MulchDetectionResult } from "./detect.js";
import { type RunMulchCommandDeps, runMulchCommand } from "./exec.js";
import { toRepoRelativePath } from "./path-utils.js";
import type {
  MulchConfig,
  MulchPrimeInjection,
  MulchPrimeRequest,
} from "./types.js";

export function buildPrimeRequest(
  detection: MulchDetectionResult,
  touchedFiles: readonly string[],
  config: MulchConfig,
): MulchPrimeRequest {
  const repoRoot =
    detection.gitRepoRoot ?? path.dirname(detection.directoryPath);
  const scopedFiles = touchedFiles
    .filter((filePath) => path.isAbsolute(filePath))
    .filter(
      (filePath) =>
        filePath === repoRoot || filePath.startsWith(`${repoRoot}${path.sep}`),
    )
    .map((filePath) => toRepoRelativePath(filePath, repoRoot))
    .filter((filePath) => filePath !== ".")
    .slice(0, config.maxTrackedFiles);

  if (scopedFiles.length > 0) {
    return {
      mode: "files",
      args: [
        "prime",
        "--files",
        ...scopedFiles,
        "--budget",
        String(config.primeBudget),
        "--format",
        "plain",
      ],
      signature: `files:${scopedFiles.join(",")}:${config.primeBudget}`,
      scopedFiles,
    };
  }

  return {
    mode: "manifest",
    args: [
      "prime",
      "--manifest",
      "--budget",
      String(config.primeBudget),
      "--format",
      "plain",
    ],
    signature: `manifest:${config.primeBudget}`,
    scopedFiles: [],
  };
}

export async function createPrimeInjection(
  params: {
    detection: MulchDetectionResult;
    touchedFiles: readonly string[];
    config: MulchConfig;
    signal?: AbortSignal;
  },
  runner: typeof runMulchCommand = runMulchCommand,
  deps: RunMulchCommandDeps = {},
): Promise<MulchPrimeInjection | null> {
  if (!params.detection.ready || !params.detection.cliCommand) {
    return null;
  }

  const request = buildPrimeRequest(
    params.detection,
    params.touchedFiles,
    params.config,
  );
  const cwd = params.detection.commandCwd;
  const result = await runner(
    {
      command: params.detection.cliCommand,
      args: request.args,
      cwd,
      signal: params.signal,
    },
    deps,
  );

  if (!result.ok) {
    return null;
  }

  const text = result.stdout.trim();
  if (text.length === 0) {
    return null;
  }

  return {
    mode: request.mode,
    signature: request.signature,
    content: text,
  };
}

export function shouldInjectPrime(
  lastSignature: string | null,
  lastContent: string | null,
  nextInjection: MulchPrimeInjection,
): boolean {
  return (
    lastSignature !== nextInjection.signature ||
    lastContent !== nextInjection.content
  );
}
