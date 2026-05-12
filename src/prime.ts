/**
 * Manifest-first and file-scoped priming with injection dedup.
 *
 * Handles injecting Mulch context into the LLM via hidden custom
 * messages in before_agent_start.
 */

import { createHash } from "node:crypto";
import type { PiMulchConfig, MulchSessionState } from "./types.js";
import { runMulch } from "./exec.js";
import { getTouchedFilesRelative } from "./paths.js";

/**
 * Compute a fast hash of priming content for dedup.
 */
function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Run `mulch prime --manifest` for first-turn injection.
 */
export async function getManifestPrime(
  command: string,
  cwd: string,
): Promise<{ content: string; hash: string; mode: "manifest" } | null> {
  const result = await runMulch(command, ["prime", "--manifest"], cwd);
  if (result.code !== 0 || !result.stdout.trim()) return null;

  const content = result.stdout.trim();
  return { content, hash: hashContent(content), mode: "manifest" };
}

/**
 * Run `mulch prime --files <paths> --budget <n>` for file-scoped injection.
 */
export async function getScopedPrime(
  command: string,
  files: string[],
  cwd: string,
  config: PiMulchConfig,
): Promise<{ content: string; hash: string; mode: "scoped" } | null> {
  if (files.length === 0) return null;

  const args = [
    "prime",
    "--compact",
    "--files",
    ...files,
    "--budget",
    String(config.injectionBudget),
  ];

  const result = await runMulch(command, args, cwd);
  if (result.code !== 0 || !result.stdout.trim()) return null;

  const content = result.stdout.trim();
  return { content, hash: hashContent(content), mode: "scoped" };
}

/**
 * Build the hidden message content for prime injection.
 */
export function buildPrimeMessage(prime: {
  content: string;
  hash: string;
  mode: string;
}): string {
  return [
    "## Mulch Context",
    `Mode: ${prime.mode}`,
    "",
    prime.content,
  ].join("\n");
}

/**
 * Compute what priming to inject for this turn.
 * Handles dedup via content hashing against state.lastPrimeHash.
 */
export async function computePriming(
  command: string,
  cwd: string,
  config: PiMulchConfig,
  state: MulchSessionState,
  signal?: AbortSignal,
): Promise<{ content: string; hash: string; mode: "manifest" | "scoped" } | null> {
  const touchedFiles = getTouchedFilesRelative(state, cwd);

  // First turn or no touched files: manifest priming
  if (!state.primedOnce || touchedFiles.length === 0) {
    if (config.injectionMode === "manifest" || config.injectionMode === "auto" || !state.primedOnce) {
      const prime = await getManifestPrime(command, cwd);
      if (!prime) return null;
      if (prime.hash === state.lastPrimeHash) return null;
      return prime;
    }
  }

  // File-scoped priming for subsequent turns with touched files
  if (touchedFiles.length > 0) {
    const prime = await getScopedPrime(command, touchedFiles, cwd, config);
    if (!prime) return null;
    if (prime.hash === state.lastPrimeHash) return null;
    return prime;
  }

  return null;
}

/**
 * Mark priming as injected (update hash in state).
 */
export function markPrimingInjected(
  state: MulchSessionState,
  hash: string,
): void {
  state.lastPrimeHash = hash;
  state.primedOnce = true;
}
