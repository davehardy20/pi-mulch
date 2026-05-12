/**
 * Per-session/repo state management and init-prompt suppression.
 *
 * Init suppression is repo-local persistent: when the user declines
 * mulch init, a marker file is created in the repo so we don't ask
 * again in future sessions.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MulchSessionState } from "./types.js";

const SUPPRESS_MARKER = ".mulch/.pi-init-suppressed";

/**
 * Create a fresh session state.
 */
export function createState(): MulchSessionState {
  return {
    initOffered: false,
    initDeclined: false,
    touchedFiles: new Set(),
    lastPrimeHash: null,
    primedOnce: false,
    lastLinterStatus: "unknown",
    draftInProgress: false,
  };
}

/**
 * Check whether init prompting is suppressed for a repo.
 */
export function isInitSuppressed(repoRoot: string): boolean {
  const markerPath = resolve(repoRoot, SUPPRESS_MARKER);
  return existsSync(markerPath);
}

/**
 * Persistently suppress init prompting for a repo.
 */
export function suppressInitForRepo(repoRoot: string): void {
  const mulchDir = resolve(repoRoot, ".mulch");
  if (!existsSync(mulchDir)) {
    mkdirSync(mulchDir, { recursive: true });
  }
  const markerPath = resolve(repoRoot, SUPPRESS_MARKER);
  writeFileSync(
    markerPath,
    `# pi-mulch extension: init prompting suppressed\n# Created: ${new Date().toISOString()}\n`,
    "utf-8",
  );
}

/**
 * Reset session state (clears in-memory state but not persistent suppression).
 */
export function resetState(state: MulchSessionState): void {
  state.initOffered = false;
  state.initDeclined = false;
  state.touchedFiles.clear();
  state.lastPrimeHash = null;
  state.primedOnce = false;
  state.lastLinterStatus = "unknown";
  state.draftInProgress = false;
}
