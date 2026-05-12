import { describe, expect, it } from "vitest";
import { detectMulch } from "../src/detect.js";

/** Helper to build execFileSync mocks that respond to `git rev-parse` and CLI `--version` probes. */
function makeExec(commands: Record<string, string | Error>) {
  return ((command: string, args?: string[]) => {
    if (command === "git" && args?.[0] === "rev-parse") {
      if (args?.[1] === "--git-common-dir") {
        // Default: not a worktree — return a path inside the repo root
        const gitResult = commands.git;
        if (gitResult instanceof Error) throw gitResult;
        const repoRoot = gitResult.trim();
        return `${repoRoot}/.git`;
      }
      const result = commands.git;
      if (result instanceof Error) throw result;
      return result;
    }
    // CLI version probe: command --version
    const result = commands[command];
    if (result instanceof Error) throw result;
    if (result !== undefined) return result;
    throw new Error(`${command} not found`);
  }) as never;
}

const statDir = (dirPath: string) =>
  ((filePath: string) => ({
    isDirectory: () => filePath === dirPath,
  })) as never;

const statNone = (() => {
  throw new Error("missing");
}) as never;

describe("detectMulch", () => {
  // --- Basic positive detection ---

  it("finds cli and .mulch at the git repo root", () => {
    const result = detectMulch(
      "/repo/subdir",
      { cliCandidates: ["mulch"] },
      {
        statSync: statDir("/repo/.mulch"),
        execFileSync: makeExec({ git: "/repo\n", mulch: "0.9.0\n" }),
      },
    );

    expect(result).toMatchObject({
      cliAvailable: true,
      cliCommand: "mulch",
      directoryExists: true,
      directoryPath: "/repo/.mulch",
      isWorktree: false,
      mainWorktreeRoot: null,
      isGitRepo: true,
      gitRepoRoot: "/repo",
      commandCwd: "/repo",
      ready: true,
    });
  });

  // --- ml fallback ---

  it("falls back to ml when mulch is not installed", () => {
    const result = detectMulch(
      "/workspace",
      { cliCandidates: ["mulch", "ml"] },
      {
        statSync: statNone,
        execFileSync: makeExec({ ml: "0.9.0\n" }),
      },
    );

    expect(result).toMatchObject({
      cliAvailable: true,
      cliCommand: "ml",
      directoryExists: false,
      isWorktree: false,
      mainWorktreeRoot: null,
      ready: false,
    });
  });

  // --- ml-only: user only has ml, not mulch ---

  it("resolves ml when mulch is absent and candidates list both", () => {
    const probed: string[] = [];
    const result = detectMulch(
      "/project",
      { cliCandidates: ["mulch", "ml"] },
      {
        statSync: statNone,
        execFileSync: ((command: string, _args?: string[]) => {
          if (command === "git") throw new Error("no git");
          probed.push(command);
          if (command === "ml") return "0.9.0\n";
          throw new Error("not found");
        }) as never,
      },
    );

    expect(result.cliCommand).toBe("ml");
    expect(result.cliAvailable).toBe(true);
    // Should have probed mulch first (failed), then ml (succeeded)
    expect(probed).toEqual(["mulch", "ml"]);
  });

  // --- mulch-only: user only has mulch, not ml ---

  it("resolves mulch when only mulch is installed", () => {
    const probed: string[] = [];
    const result = detectMulch(
      "/project",
      { cliCandidates: ["mulch", "ml"] },
      {
        statSync: statNone,
        execFileSync: ((command: string, _args?: string[]) => {
          if (command === "git") throw new Error("no git");
          probed.push(command);
          if (command === "mulch") return "0.9.0\n";
          throw new Error("not found");
        }) as never,
      },
    );

    expect(result.cliCommand).toBe("mulch");
    expect(result.cliAvailable).toBe(true);
    // Should have found mulch on first try; no need to try ml
    expect(probed).toEqual(["mulch"]);
  });

  // --- Neither installed ---

  it("reports cli unavailable when neither mulch nor ml is installed", () => {
    const result = detectMulch(
      "/project",
      { cliCandidates: ["mulch", "ml"] },
      {
        statSync: statNone,
        execFileSync: makeExec({}),
      },
    );

    expect(result).toMatchObject({
      cliAvailable: false,
      cliCommand: null,
      isWorktree: false,
      mainWorktreeRoot: null,
      ready: false,
    });
  });

  // --- User overrides command to ml ---

  it("uses explicit command override when set and available", () => {
    const probed: string[] = [];
    const result = detectMulch(
      "/project",
      { command: "ml", cliCandidates: ["mulch", "ml"] },
      {
        statSync: statNone,
        execFileSync: ((command: string, _args?: string[]) => {
          if (command === "git") throw new Error("no git");
          probed.push(command);
          return "0.9.0\n"; // both work
        }) as never,
      },
    );

    expect(result.cliCommand).toBe("ml");
    // Explicit command is tried first, should succeed immediately
    expect(probed).toEqual(["ml"]);
  });

  // --- User overrides command but it fails, falls back to candidates ---

  it("falls back to candidates when explicit command override fails", () => {
    const probed: string[] = [];
    const result = detectMulch(
      "/project",
      { command: "nonexistent-cli", cliCandidates: ["mulch", "ml"] },
      {
        statSync: statNone,
        execFileSync: ((command: string, _args?: string[]) => {
          if (command === "git") throw new Error("no git");
          probed.push(command);
          if (command === "ml") return "0.9.0\n";
          throw new Error("not found");
        }) as never,
      },
    );

    expect(result.cliCommand).toBe("ml");
    // nonexistent-cli tried first (fails), then mulch (fails), then ml (succeeds)
    expect(probed).toEqual(["nonexistent-cli", "mulch", "ml"]);
  });

  // --- Custom cliCandidates override ---

  it("uses custom cliCandidates from config", () => {
    const probed: string[] = [];
    const result = detectMulch(
      "/project",
      { command: null, cliCandidates: ["/usr/local/bin/mulch", "ml"] },
      {
        statSync: statNone,
        execFileSync: ((command: string, _args?: string[]) => {
          if (command === "git") throw new Error("no git");
          probed.push(command);
          if (command === "/usr/local/bin/mulch") return "0.9.0\n";
          throw new Error("not found");
        }) as never,
      },
    );

    expect(result.cliCommand).toBe("/usr/local/bin/mulch");
    expect(probed).toEqual(["/usr/local/bin/mulch"]);
  });

  // --- Empty/null command uses candidates only ---

  it("skips empty command and goes straight to candidates", () => {
    const probed: string[] = [];
    const result = detectMulch(
      "/project",
      { command: "", cliCandidates: ["ml"] },
      {
        statSync: statNone,
        execFileSync: ((command: string, _args?: string[]) => {
          if (command === "git") throw new Error("no git");
          probed.push(command);
          if (command === "ml") return "0.9.0\n";
          throw new Error("not found");
        }) as never,
      },
    );

    expect(result.cliCommand).toBe("ml");
    // Empty string command should be skipped; only candidate "ml" probed
    expect(probed).toEqual(["ml"]);
  });

  it("skips null command and goes straight to candidates", () => {
    const result = detectMulch(
      "/project",
      { command: null, cliCandidates: ["mulch", "ml"] },
      {
        statSync: statNone,
        execFileSync: makeExec({ mulch: "1.0.0\n" }),
      },
    );

    expect(result.cliCommand).toBe("mulch");
  });

  // --- Default candidates used when no options provided ---

  it("uses default candidates [mulch, ml] when no options given", () => {
    const probed: string[] = [];
    const result = detectMulch(
      "/project",
      {},
      {
        statSync: statNone,
        execFileSync: ((command: string, _args?: string[]) => {
          if (command === "git") throw new Error("no git");
          probed.push(command);
          if (command === "ml") return "0.9.0\n";
          throw new Error("not found");
        }) as never,
      },
    );

    expect(result.cliCommand).toBe("ml");
    expect(probed).toEqual(["mulch", "ml"]);
  });

  // --- Deduplication: command override same as candidate ---

  it("deduplicates when explicit command matches a candidate", () => {
    const probed: string[] = [];
    const result = detectMulch(
      "/project",
      { command: "mulch", cliCandidates: ["mulch", "ml"] },
      {
        statSync: statNone,
        execFileSync: ((command: string, _args?: string[]) => {
          if (command === "git") throw new Error("no git");
          probed.push(command);
          throw new Error("not found");
        }) as never,
      },
    );

    expect(result.cliCommand).toBeNull();
    // "mulch" tried once (as explicit), then deduped from candidates, "ml" tried once
    expect(probed).toEqual(["mulch", "ml"]);
  });

  // --- Worktree detection ---

  it("detects worktree via --git-common-dir pointing outside repo root", () => {
    const result = detectMulch(
      "/worktree",
      { cliCandidates: ["mulch"] },
      {
        statSync: statNone,
        execFileSync: ((command: string, args?: string[]) => {
          if (command === "git") {
            if (args?.[0] === "rev-parse") {
              if (args?.[1] === "--show-toplevel") return "/worktree\n";
              if (args?.[1] === "--git-common-dir") return "/main-repo/.git\n";
            }
            return "";
          }
          if (command === "mulch") return "0.9.0\n";
          throw new Error("not found");
        }) as never,
      },
    );

    expect(result.isWorktree).toBe(true);
    expect(result.mainWorktreeRoot).toBe("/main-repo");
    expect(result.gitRepoRoot).toBe("/worktree");
    expect(result.directoryPath).toBe("/worktree/.mulch");
    expect(result.directoryExists).toBe(false);
  });

  it("falls back to main worktree .mulch/ when worktree has none", () => {
    const result = detectMulch(
      "/worktree",
      { cliCandidates: ["mulch"] },
      {
        // .mulch only exists in the main repo, not in the worktree
        statSync: ((filePath: string) => ({
          isDirectory: () => filePath === "/main-repo/.mulch",
        })) as never,
        execFileSync: ((command: string, args?: string[]) => {
          if (command === "git") {
            if (args?.[0] === "rev-parse") {
              if (args?.[1] === "--show-toplevel") return "/worktree\n";
              if (args?.[1] === "--git-common-dir") return "/main-repo/.git\n";
            }
            return "";
          }
          if (command === "mulch") return "0.9.0\n";
          throw new Error("not found");
        }) as never,
      },
    );

    expect(result.isWorktree).toBe(true);
    expect(result.mainWorktreeRoot).toBe("/main-repo");
    // directoryPath should resolve to the main repo's .mulch
    expect(result.directoryPath).toBe("/main-repo/.mulch");
    expect(result.directoryExists).toBe(true);
    expect(result.commandCwd).toBe("/main-repo");
    expect(result.ready).toBe(true);
  });

  it("prefers worktree-local .mulch/ over main worktree .mulch/", () => {
    const result = detectMulch(
      "/worktree",
      { cliCandidates: ["mulch"] },
      {
        // Both exist, but worktree-local is checked first
        statSync: (() => ({
          isDirectory: () => true,
        })) as never,
        execFileSync: ((command: string, args?: string[]) => {
          if (command === "git") {
            if (args?.[0] === "rev-parse") {
              if (args?.[1] === "--show-toplevel") return "/worktree\n";
              if (args?.[1] === "--git-common-dir") return "/main-repo/.git\n";
            }
            return "";
          }
          if (command === "mulch") return "0.9.0\n";
          throw new Error("not found");
        }) as never,
      },
    );

    expect(result.isWorktree).toBe(true);
    expect(result.mainWorktreeRoot).toBe("/main-repo");
    // Should use the worktree-local .mulch
    expect(result.directoryPath).toBe("/worktree/.mulch");
    expect(result.directoryExists).toBe(true);
    // commandCwd stays at worktree root since .mulch found locally
    expect(result.commandCwd).toBe("/worktree");
  });

  it("reports not a worktree when --git-common-dir is relative", () => {
    const result = detectMulch(
      "/repo",
      { cliCandidates: ["mulch"] },
      {
        statSync: statDir("/repo/.mulch"),
        execFileSync: ((command: string, args?: string[]) => {
          if (command === "git") {
            if (args?.[0] === "rev-parse") {
              if (args?.[1] === "--show-toplevel") return "/repo\n";
              if (args?.[1] === "--git-common-dir") return ".git\n";
            }
            return "";
          }
          if (command === "mulch") return "0.9.0\n";
          throw new Error("not found");
        }) as never,
      },
    );

    expect(result.isWorktree).toBe(false);
    expect(result.mainWorktreeRoot).toBeNull();
    expect(result.directoryPath).toBe("/repo/.mulch");
  });

  it("reports not a worktree when --git-common-dir fails", () => {
    const result = detectMulch(
      "/repo",
      { cliCandidates: ["mulch"] },
      {
        statSync: statDir("/repo/.mulch"),
        execFileSync: ((command: string, args?: string[]) => {
          if (command === "git") {
            if (args?.[0] === "rev-parse") {
              if (args?.[1] === "--show-toplevel") return "/repo\n";
              if (args?.[1] === "--git-common-dir")
                throw new Error("unsupported");
            }
            return "";
          }
          if (command === "mulch") return "0.9.0\n";
          throw new Error("not found");
        }) as never,
      },
    );

    expect(result.isWorktree).toBe(false);
    expect(result.mainWorktreeRoot).toBeNull();
    expect(result.ready).toBe(true);
  });
});
