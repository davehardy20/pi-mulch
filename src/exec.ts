/**
 * Safe Mulch command execution with CLI and programmatic fallbacks
 */

import { execFile } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import type { PiMulchConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Core result types
// ---------------------------------------------------------------------------

export interface MulchExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface MulchPlanResult {
  displayCommand: string;
  cwd: string;
  exitCode: number | null;
  timedOut: boolean;
  aborted: boolean;
  stdout: string;
  stderr: string;
}

// ---------------------------------------------------------------------------
// Mulch request / plan types
// ---------------------------------------------------------------------------

export interface MulchRequest {
  command: string;
  // prime
  manifest?: boolean;
  domains?: string[];
  files?: string[];
  budget?: number;
  format?: "compact" | "xml" | "json" | "markdown";
  // search
  query?: string;
  domain?: string;
  type?: string;
  // learn
  since?: string;
  // sync
  message?: string;
  noValidate?: boolean;
  // prune / delete / delete-domain
  dryRun?: boolean;
  records?: string[];
  // general
  allowWrite?: boolean;
}

export interface MulchExecPlan {
  executable: string;
  args: string[];
  cwd: string;
  displayCommand: string;
  timeoutMs: number;
}

export interface ExecPlanOptions {
  allowWrite?: boolean;
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const UNSAFE_CHARS = /[;|&$`\\\n\r]/;
const MAX_PATHS = 50;
const MIN_BUDGET = 100;
const MAX_BUDGET = 100_000;
const MIN_TIMEOUT = 1_000;
const MAX_TIMEOUT = 120_000;
const DEFAULT_TIMEOUT = 30_000;

const VALID_FORMATS = ["compact", "xml", "json", "markdown"] as const;
const VALID_TYPES = [
  "convention",
  "pattern",
  "failure",
  "decision",
  "reference",
  "guide",
] as const;

function rejectUnsafe(value: string, label: string): void {
  if (UNSAFE_CHARS.test(value)) {
    throw new Error(`${label} contains unsupported characters`);
  }
}

function isPathOutsideWorkspace(filePath: string, cwd: string): boolean {
  const resolved = path.resolve(cwd, filePath);
  const normalized = path.normalize(resolved);
  const normalizedCwd = path.normalize(cwd);
  return !normalized.startsWith(normalizedCwd);
}

// ---------------------------------------------------------------------------
// resolveMulchBinary
// ---------------------------------------------------------------------------

/**
 * Resolve the mulch binary path.
 * Checks: absolute path, node_modules/.bin, then PATH.
 */
export function resolveMulchBinary(
  command: string,
  cwd: string,
): string {
  // Absolute path
  if (path.isAbsolute(command)) {
    if (fs.existsSync(command)) return command;
    throw new Error(`Mulch binary not found: ${command}`);
  }

  // node_modules/.bin
  const localBin = path.join(cwd, "node_modules", ".bin", command);
  if (fs.existsSync(localBin)) return localBin;

  // PATH lookup
  const pathEnv = process.env.PATH ?? "";
  const dirs = pathEnv.split(path.delimiter);
  for (const dir of dirs) {
    const candidate = path.join(dir, command);
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(`Mulch binary not found: ${command}`);
}

// ---------------------------------------------------------------------------
// buildMulchExecPlan
// ---------------------------------------------------------------------------

/**
 * Build a validated execution plan from a MulchRequest.
 */
export function buildMulchExecPlan(
  request: MulchRequest,
  config: PiMulchConfig,
  cwd: string,
  options: ExecPlanOptions = {},
): MulchExecPlan {
  const executable = resolveMulchBinary(config.command, cwd);
  const args: string[] = [request.command];
  let timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  timeoutMs = Math.max(MIN_TIMEOUT, Math.min(MAX_TIMEOUT, timeoutMs));

  switch (request.command) {
    case "prime": {
      if (request.manifest) args.push("--manifest");
      if (request.domains && request.domains.length > 0) {
        args.push("--domain", ...request.domains);
      }
      if (request.files && request.files.length > 0) {
        if (request.files.length > MAX_PATHS) {
          throw new Error(`Too many paths (max ${MAX_PATHS})`);
        }
        for (const f of request.files) {
          if (isPathOutsideWorkspace(f, cwd)) {
            throw new Error(`Path outside the workspace: ${f}`);
          }
        }
        args.push("--files", ...request.files);
      }
      if (request.budget !== undefined) {
        if (request.budget < MIN_BUDGET || request.budget > MAX_BUDGET) {
          throw new Error(
            `Budget must be between ${MIN_BUDGET} and ${MAX_BUDGET}`,
          );
        }
        args.push("--budget", String(request.budget));
      }
      if (request.format) {
        if (!VALID_FORMATS.includes(request.format as (typeof VALID_FORMATS)[number])) {
          throw new Error(`Unsupported format: ${request.format}`);
        }
        if (request.format === "compact") {
          args.push("--compact");
        } else {
          args.push("--format", request.format);
        }
      }
      break;
    }
    case "search": {
      if (!request.query || request.query.trim() === "") {
        throw new Error("Query cannot be empty");
      }
      rejectUnsafe(request.query, "Query");
      args.push(request.query);
      if (request.domain) {
        args.push("--domain", request.domain);
      }
      if (request.type) {
        if (!VALID_TYPES.includes(request.type as (typeof VALID_TYPES)[number])) {
          throw new Error(`Unsupported type: ${request.type}`);
        }
        args.push("--type", request.type);
      }
      break;
    }
    case "query": {
      if (request.domain) {
        args.push(request.domain);
      }
      break;
    }
    case "status": {
      // No additional args
      break;
    }
    case "learn": {
      if (request.since) {
        rejectUnsafe(request.since, "Since value");
        args.push("--since", request.since);
      }
      break;
    }
    // Write commands — require allowWrite
    case "sync": {
      if (!options.allowWrite) {
        throw new Error(
          "sync is write-capable and requires explicit user approval",
        );
      }
      if (request.message) {
        rejectUnsafe(request.message, "Message");
        args.push("--message", request.message);
      }
      if (request.noValidate) args.push("--no-validate");
      break;
    }
    case "prune": {
      if (!options.allowWrite) {
        throw new Error(
          "prune is write-capable and requires explicit user approval",
        );
      }
      if (request.dryRun) args.push("--dry-run");
      break;
    }
    case "delete": {
      if (!options.allowWrite) {
        throw new Error(
          "delete is write-capable and requires explicit user approval",
        );
      }
      if (!request.domain) throw new Error("domain is required for delete");
      rejectUnsafe(request.domain, "Domain");
      args.push(request.domain);
      if (request.records && request.records.length > 0) {
        args.push("--records", request.records.join(","));
      }
      break;
    }
    case "delete-domain": {
      if (!options.allowWrite) {
        throw new Error(
          "delete-domain is write-capable and requires explicit user approval",
        );
      }
      if (!request.domain) throw new Error("domain is required for delete-domain");
      rejectUnsafe(request.domain, "Domain");
      args.push(request.domain);
      if (request.dryRun) args.push("--dry-run");
      break;
    }
    default:
      throw new Error(`Unknown mulch command: ${request.command}`);
  }

  const displayCommand = `${config.command} ${args.join(" ")}`;

  return { executable, args, cwd, displayCommand, timeoutMs };
}

// ---------------------------------------------------------------------------
// executeMulchPlan
// ---------------------------------------------------------------------------

/**
 * Execute a validated MulchExecPlan as a child process.
 */
export async function executeMulchPlan(
  plan: MulchExecPlan,
  signal?: AbortSignal,
): Promise<MulchPlanResult> {
  if (signal?.aborted) {
    return {
      displayCommand: plan.displayCommand,
      cwd: plan.cwd,
      exitCode: null,
      timedOut: false,
      aborted: true,
      stdout: "",
      stderr: "",
    };
  }

  return new Promise<MulchPlanResult>((resolve) => {
    let timedOut = false;

    const child = execFile(
      plan.executable,
      plan.args,
      { cwd: plan.cwd, timeout: plan.timeoutMs, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          displayCommand: plan.displayCommand,
          cwd: plan.cwd,
          exitCode: error && !timedOut ? (error.code as number ?? 1) : timedOut ? null : 0,
          timedOut,
          aborted: false,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
        });
      },
    );

    child.on("close", () => {});

    // Handle timeout detection via the error callback
    child.on("error", (err) => {
      if (err && (err as NodeJS.ErrnoException).killed) {
        timedOut = true;
      }
    });

    signal?.addEventListener(
      "abort",
      () => {
        child.kill("SIGTERM");
        resolve({
          displayCommand: plan.displayCommand,
          cwd: plan.cwd,
          exitCode: null,
          timedOut: false,
          aborted: true,
          stdout: "",
          stderr: "",
        });
      },
      { once: true },
    );
  });
}

// ---------------------------------------------------------------------------
// formatMulchResult
// ---------------------------------------------------------------------------

/**
 * Format a MulchPlanResult into a human-readable string.
 */
export function formatMulchResult(result: MulchPlanResult): string {
  const lines: string[] = [];
  lines.push(`Command: ${result.displayCommand}`);
  lines.push(`CWD: ${result.cwd}`);

  if (result.aborted) {
    lines.push("Status: aborted");
  } else if (result.timedOut) {
    lines.push("Status: timed out");
  } else {
    lines.push(`Exit code: ${result.exitCode}`);
  }

  lines.push("");

  const output = result.stdout || result.stderr || "(no output)";
  lines.push(output);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// runMulch (low-level)
// ---------------------------------------------------------------------------

export async function runMulch(
  command: string,
  args: string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<MulchExecResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      { cwd, timeout: 30000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && !error.killed && error.code !== 0) {
          resolve({
            stdout: stdout ?? "",
            stderr: stderr ?? "",
            code: error.code ?? 1,
          });
          return;
        }
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          code: 0,
        });
      },
    );

    signal?.addEventListener("abort", () => {
      child.kill("SIGTERM");
      reject(new Error("Aborted"));
    });
  });
}

// ---------------------------------------------------------------------------
// runMulchCommand (high-level: build plan + execute)
// ---------------------------------------------------------------------------

/**
 * High-level Mulch command execution used by tools.
 * Builds a plan, executes it, and returns the result.
 */
export async function runMulchCommand(
  request: MulchRequest,
  config: PiMulchConfig,
  cwd: string,
  options: { signal?: AbortSignal } = {},
): Promise<MulchPlanResult> {
  const plan = buildMulchExecPlan(request, config, cwd, {
    allowWrite: request.allowWrite,
  });
  return executeMulchPlan(plan, options.signal);
}

// ---------------------------------------------------------------------------
// normalizeFilePath
// ---------------------------------------------------------------------------

export function normalizeFilePath(
  filePath: string | undefined,
  cwd: string,
): string | null {
  if (!filePath) return null;
  try {
    return path.resolve(cwd, filePath);
  } catch {
    return null;
  }
}
