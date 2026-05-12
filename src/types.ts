/**
 * Shared types and interfaces for the pi-mulch extension.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Resolved Mulch extension configuration.
 */
export interface PiMulchConfig {
  /** Enable or disable the entire extension */
  enabled: boolean;
  /** CLI binary name or path; auto-detected if bare name */
  command: string;
  /** Priming mode: "manifest" | "prime" | "auto" */
  injectionMode: "manifest" | "prime" | "auto";
  /** Token budget for priming output */
  injectionBudget: number;
  /** Whether to suppress init prompting entirely */
  suppressInitPrompt: boolean;
  /** Draft mode: "auto" | "manual" | "off" */
  draftMode: "auto" | "manual" | "off";
  /** Domains to auto-generate drafts for at session end */
  autoLearnDomains: string[];
}

/** Default configuration values. */
export const DEFAULT_CONFIG: PiMulchConfig = {
  enabled: true,
  command: "mulch",
  injectionMode: "manifest",
  injectionBudget: 4000,
  suppressInitPrompt: false,
  draftMode: "auto",
  autoLearnDomains: ["general"],
};

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

/** Per-session mutable state */
export interface MulchState {
  /** Whether init has been offered this session */
  initOffered: boolean;
  /** Whether the user declined init this session */
  initDeclined: boolean;
  /** Whether we have primed at least once */
  primedOnce: boolean;
  /** The last priming content hash injected (for dedup) */
  lastPrimeHash: string | null;
  /** Set of normalized file paths touched this session */
  touchedFiles: Set<string>;
  /** Last known linter status */
  lastLinterStatus: "unknown" | "clean" | "dirty" | "running";
  /** Whether a draft generation is in progress */
  draftInProgress: boolean;
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

/** Draft record metadata */
export interface DraftRecord {
  id: string;
  domain: string;
  type: "convention" | "pattern" | "failure" | "decision" | "reference" | "guide" | "observational";
  title?: string;
  name?: string;
  description?: string;
  content?: string;
  resolution?: string;
  rationale?: string;
  files: string[];
  filePath?: string;
  createdAt: string;
  applied: boolean;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** Result of Mulch CLI and .mulch/ detection */
export interface MulchDetection {
  cliAvailable: boolean;
  cliCommand: string;
  cliPath: string;
  version: string;
  dotMulchExists: boolean;
  mulchDirExists: boolean;
  mulchDirPath: string | null;
  repoRoot: string;
}

// ---------------------------------------------------------------------------
// Aliases for backward compatibility
// ---------------------------------------------------------------------------

/** Per-session mutable state (alias for MulchState) */
export type MulchSessionState = MulchState;
