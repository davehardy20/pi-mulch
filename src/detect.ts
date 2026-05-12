import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface MulchDetectionResult {
  cliAvailable: boolean;
  cliCommand: string | null;
  directoryExists: boolean;
  directoryPath: string;
  /** True when the detected root is a git worktree (linked .git file). */
  isWorktree: boolean;
  /**
   * The main working tree root when inside a worktree, or the parent
   * repo root when inside a submodule. `null` when not applicable.
   */
  mainWorktreeRoot: string | null;
  isGitRepo: boolean;
  gitRepoRoot: string | null;
  /**
   * The working directory to use when invoking mulch CLI commands.
   * Normally equals `gitRepoRoot`, but when `.mulch/` was found in the
   * main worktree, this is set to `mainWorktreeRoot` so that the CLI
   * resolves `.mulch/` correctly.
   */
  commandCwd: string;
  ready: boolean;
}

export interface DetectDeps {
  statSync?: typeof fs.statSync;
  execFileSync?: typeof childProcess.execFileSync;
}

export interface DetectOptions {
  command?: string | null;
  cliCandidates?: readonly string[];
}

/**
 * Candidate CLI binary names tried in order during auto-detection.
 *
 * Mulch is distributed as both `mulch` and `ml`; either or both may be
 * present on a given system.  The extension resolves the actual binary at
 * detection time so that all subsequent tool/command invocations use the
 * correct name, regardless of which alias is installed.
 */
const DEFAULT_CLI_CANDIDATES = ["mulch", "ml"] as const;

export function detectMulch(
  cwd: string,
  options: DetectOptions = {},
  deps: DetectDeps = {},
): MulchDetectionResult {
  const statSync = deps.statSync ?? fs.statSync;
  const execFileSync = deps.execFileSync ?? childProcess.execFileSync;

  const gitRepoRoot = findGitRepoRoot(cwd, execFileSync);
  const isGitRepo = gitRepoRoot !== null;
  const repoRoot = gitRepoRoot ?? cwd;

  // Detect worktree: the main working tree root is derived from
  // --git-common-dir which points to the primary .git directory.
  const { isWorktree, mainWorktreeRoot } = resolveWorktreeInfo(
    repoRoot,
    execFileSync,
  );

  // Resolve .mulch/ in the detected repo root first.
  // If not found and we are in a worktree, fall back to the main
  // working tree so a shared .mulch/ is discovered.
  let directoryPath = path.resolve(repoRoot, ".mulch");
  let directoryExists = isDirectory(directoryPath, statSync);
  let commandCwd = repoRoot;

  if (!directoryExists && isWorktree && mainWorktreeRoot) {
    const mainMulchPath = path.resolve(mainWorktreeRoot, ".mulch");
    if (isDirectory(mainMulchPath, statSync)) {
      directoryPath = mainMulchPath;
      directoryExists = true;
      commandCwd = mainWorktreeRoot;
    }
  }

  const cliCommand = resolveCliCommand(options, execFileSync);
  const cliAvailable = cliCommand !== null;

  return {
    cliAvailable,
    cliCommand,
    directoryExists,
    directoryPath,
    isWorktree,
    mainWorktreeRoot,
    isGitRepo,
    gitRepoRoot,
    commandCwd,
    ready: cliAvailable && directoryExists,
  };
}

/**
 * Resolve the Mulch CLI binary name.
 *
 * Resolution order:
 *   1. Explicit `command` override from config (if non-empty).
 *   2. Config-provided `cliCandidates` (or `DEFAULT_CLI_CANDIDATES`).
 * Candidates are deduplicated, then probed with `--version`.
 * The first candidate that succeeds becomes `cliCommand` for the session.
 */
function resolveCliCommand(
  options: DetectOptions,
  execFileSync: typeof childProcess.execFileSync,
): string | null {
  const candidates = [
    ...(typeof options.command === "string" && options.command.trim().length > 0
      ? [options.command.trim()]
      : []),
    ...(options.cliCandidates ?? DEFAULT_CLI_CANDIDATES),
  ];

  for (const candidate of new Set(candidates)) {
    try {
      execFileSync(candidate, ["--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return candidate;
    } catch {
      // try next candidate
    }
  }

  return null;
}

function isDirectory(
  directoryPath: string,
  statSync: typeof fs.statSync,
): boolean {
  try {
    return statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function findGitRepoRoot(
  cwd: string,
  execFileSync: typeof childProcess.execFileSync,
): string | null {
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const trimmed = root.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * Determine whether the current working tree is a linked worktree and, if
 * so, resolve the main working tree root.
 *
 * Strategy:
 *  - `--git-common-dir` returns the canonical .git location.
 *    In a linked worktree this is an absolute path pointing to the primary
 *    repo's .git directory (e.g. `/repo/.git`).
 *  - In the main working tree `--git-common-dir` returns a relative `.git`.
 *  - By comparing the common-dir parent with `--show-toplevel` we can tell
 *    whether we are in a linked worktree and extract the main tree root.
 */
function resolveWorktreeInfo(
  repoRoot: string,
  execFileSync: typeof childProcess.execFileSync,
): { isWorktree: boolean; mainWorktreeRoot: string | null } {
  try {
    const commonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

    if (!commonDir) {
      return { isWorktree: false, mainWorktreeRoot: null };
    }

    // An absolute common-dir that doesn't live under repoRoot means
    // we are in a linked worktree.
    const absoluteCommonDir = path.resolve(repoRoot, commonDir);
    if (!absoluteCommonDir.startsWith(repoRoot + path.sep)) {
      // common-dir is like /main-repo/.git — parent is main worktree root
      const mainRoot = path.dirname(absoluteCommonDir);
      return { isWorktree: true, mainWorktreeRoot: mainRoot };
    }

    return { isWorktree: false, mainWorktreeRoot: null };
  } catch {
    return { isWorktree: false, mainWorktreeRoot: null };
  }
}
