/**
 * Safe argv-based Mulch command execution.
 *
 * Provides both simple `runMulch` and structured `runMulchCommand` interfaces.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, normalize } from "node:path";
import { existsSync, statSync } from "node:fs";
import type { MulchExecResult, MulchCommandResult } from "./types.js";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 256 * 1024;

/**
 * Normalize a file path to an absolute resolved form.
 */
export function normalizeFilePath(
  rawPath: string | undefined,
  cwd: string,
): string | null {
  if (!rawPath || typeof rawPath !== "string") return null;
  try {
    const cleaned = rawPath.startsWith("@") ? rawPath.slice(1) : rawPath;
    if (!cleaned) return null;
    return normalize(resolve(cwd, cleaned));
  } catch {
    return null;
  }
}

/**
 * Resolve the mulch binary path.
 */
export function resolveMulchBinary(command: string, cwd: string): string {
  // Try as absolute path first
  if (command.startsWith("/")) {
    if (existsSync(command)) return command;
  }

  // Try node_modules/.bin
  const localBin = resolve(cwd, "node_modules", ".bin", command);
  if (existsSync(localBin) && statSync(localBin).isFile()) {
    return localBin;
  }

  // Fall back to the command name itself (will be resolved by PATH)
  return command;
}

function truncateOutput(output: string): string {
  if (Buffer.byteLength(output, "utf8") <= MAX_OUTPUT_BYTES) {
    return output;
  }
  const marker = "\n… output truncated …\n";
  const budget = MAX_OUTPUT_BYTES - Buffer.byteLength(marker, "utf8");
  if (budget <= 0) return marker;
  return `${marker}${output.slice(-budget)}`;
}

function buildDisplayCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

/**
 * Build a structured execution plan for a mulch command.
 */
export function buildMulchExecPlan(
  command: string,
  args: string[],
  cwd: string,
): { command: string; args: string[]; cwd: string; displayCommand: string } {
  return {
    command,
    args,
    cwd,
    displayCommand: buildDisplayCommand(command, args),
  };
}

/**
 * Execute a structured mulch command plan.
 */
export async function executeMulchPlan(
  plan: { command: string; args: string[]; cwd: string },
  signal?: AbortSignal,
): Promise<MulchCommandResult> {
  const displayCommand = buildDisplayCommand(plan.command, plan.args);

  try {
    const { stdout, stderr } = await execFileAsync(plan.command, plan.args, {
      cwd: plan.cwd,
      signal: signal ?? undefined,
      timeout: DEFAULT_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
    });

    return {
      displayCommand,
      cwd: plan.cwd,
      exitCode: 0,
      timedOut: false,
      aborted: false,
      stdout: truncateOutput(stdout),
      stderr: truncateOutput(stderr),
    };
  } catch (err: unknown) {
    const error = err as {
      stdout?: string;
      stderr?: string;
      code?: string | number;
      killed?: boolean;
      signal?: string;
    };

    const timedOut = error.killed === true;
    const aborted = error.signal === "SIGTERM" || error.signal === "SIGKILL";

    return {
      displayCommand,
      cwd: plan.cwd,
      exitCode: typeof error.code === "number" ? error.code : null,
      timedOut,
      aborted: aborted && !timedOut,
      stdout: truncateOutput(error.stdout ?? ""),
      stderr: truncateOutput(error.stderr ?? String(err)),
    };
  }
}

/**
 * Format a mulch command result for display.
 */
export function formatMulchResult(result: MulchCommandResult): string {
  const lines = [
    `Command: ${result.displayCommand}`,
    `CWD: ${result.cwd}`,
  ];

  if (result.timedOut) {
    lines.push("Status: timed out");
  } else if (result.aborted) {
    lines.push("Status: aborted");
  } else {
    lines.push(`Exit code: ${result.exitCode ?? "null"}`);
  }

  lines.push("");
  lines.push(result.stdout || result.stderr || "(no output)");
  return lines.join("\n").trim();
}

/**
 * Run a mulch command with structured result.
 * This is used by tools.ts for the structured command interface.
 */
export async function runMulchCommand(
  params: Record<string, unknown>,
  config: PiMulchConfig,
  cwd: string,
  options?: { signal?: AbortSignal },
): Promise<MulchCommandResult> {
  const command = (params.command as string) ?? config.command;
  const mulchArgs = buildArgsFromParams(params);
  const resolvedCommand = resolveMulchBinary(command, cwd);

  const plan = buildMulchExecPlan(resolvedCommand, mulchArgs, cwd);
  return executeMulchPlan(plan, options?.signal);
}

function buildArgsFromParams(params: Record<string, unknown>): string[] {
  const args: string[] = [];
  const command = params.command as string | undefined;

  if (command === "prime") {
    args.push("prime");
    if (params.manifest) args.push("--manifest");
    if (params.compact) args.push("--compact");
    if (params.full) args.push("--full");
    if (params.budget) args.push("--budget", String(params.budget));
    const files = params.files as string[] | undefined;
    if (files && files.length > 0) {
      args.push("--files", ...files);
    }
    const domain = params.domain as string[] | undefined;
    if (domain && domain.length > 0) {
      args.push("--domain", ...domain);
    }
  } else if (command === "search") {
    args.push("search");
    if (params.query) args.push(String(params.query));
    if (params.domain) args.push("--domain", String(params.domain));
    if (params.format) args.push("--format", String(params.format));
  } else if (command === "query") {
    args.push("query");
    if (params.domain) args.push(String(params.domain));
    if (params.type) args.push("--type", String(params.type));
    if (params.format) args.push("--format", String(params.format));
  } else if (command === "learn") {
    args.push("learn");
    if (params.since) args.push("--since", String(params.since));
  } else if (command === "status") {
    args.push("status");
  } else if (command === "sync") {
    args.push("sync");
  } else if (command === "prune") {
    args.push("prune");
    if (params.dryRun) args.push("--dry-run");
  } else if (command === "delete") {
    args.push("delete");
    if (params.domain) args.push(String(params.domain));
    if (params.id) args.push(String(params.id));
  } else if (command === "delete-domain") {
    args.push("delete-domain");
    if (params.domain) args.push(String(params.domain));
  } else if (command) {
    args.push(command);
  }

  return args;
}

// Import PiMulchConfig type for runMulchCommand
import type { PiMulchConfig } from "./types.js";

/**
 * Run a mulch command with simple result (used by draft, prime, etc.).
 */
export async function runMulch(
  command: string,
  args: string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<MulchExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      signal: signal ?? undefined,
      timeout: DEFAULT_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
    });

    return {
      stdout: truncateOutput(stdout),
      stderr: truncateOutput(stderr),
      code: 0,
    };
  } catch (err: unknown) {
    const error = err as {
      stdout?: string;
      stderr?: string;
      code?: string | number;
      killed?: boolean;
    };

    if (error.killed) {
      return {
        stdout: "",
        stderr: "Command timed out",
        code: null,
      };
    }

    return {
      stdout: truncateOutput(error.stdout ?? ""),
      stderr: truncateOutput(error.stderr ?? String(err)),
      code: typeof error.code === "number" ? error.code : 1,
    };
  }
}
