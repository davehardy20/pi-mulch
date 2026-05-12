import type { ExecFileException } from "node:child_process";
import { describe, expect, it } from "vitest";
import { formatMulchResult, runMulchCommand } from "../src/exec.js";

type ExecFileCallback = (
  error: ExecFileException | null,
  stdout: string,
  stderr: string,
) => void;

function mockExecFile(
  handler: (cmd: string, args: readonly string[], cb: ExecFileCallback) => void,
) {
  return ((
    _cmd: string,
    _args: readonly string[] | undefined | null,
    _opts: unknown,
    cb: ExecFileCallback,
  ) => {
    handler(_cmd, _args ?? [], cb);
  }) as never;
}

describe("runMulchCommand", () => {
  it("returns error result when command is null", async () => {
    const result = await runMulchCommand({
      command: null,
      args: ["status"],
      cwd: "/repo",
    });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("Mulch CLI is not configured or available.");
    expect(result.command).toBe("");
    expect(result.stdout).toBe("");
  });

  it("returns error result when command is undefined", async () => {
    const result = await runMulchCommand({
      command: undefined as unknown as null,
      args: ["status"],
      cwd: "/repo",
    });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it("returns error result when child process fails", async () => {
    const result = await runMulchCommand(
      {
        command: "mulch",
        args: ["status"],
        cwd: "/repo",
      },
      {
        execFile: mockExecFile((_cmd, _args, cb) => {
          const error = new Error("spawn mulch ENOENT") as ExecFileException;
          (error as Error & { code: string }).code = "ENOENT";
          cb(error, "", "");
        }),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.command).toBe("mulch");
  });

  it("returns error result when command exits with non-zero code", async () => {
    const result = await runMulchCommand(
      {
        command: "mulch",
        args: ["search", "nonexistent"],
        cwd: "/repo",
      },
      {
        execFile: mockExecFile((_cmd, _args, cb) => {
          const error = new Error("exit 1") as ExecFileException;
          (error as Error & { code: number }).code = 1;
          cb(error, "", "no results found");
        }),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("no results found");
  });

  it("parses JSON output when ok and json flag is set", async () => {
    const result = await runMulchCommand(
      {
        command: "mulch",
        args: ["status"],
        cwd: "/repo",
        json: true,
      },
      {
        execFile: mockExecFile((_cmd, _args, cb) => {
          cb(null, '{"domains":3}', "");
        }),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.json).toEqual({ domains: 3 });
  });

  it("leaves json undefined when output is not valid JSON", async () => {
    const result = await runMulchCommand(
      {
        command: "mulch",
        args: ["status"],
        cwd: "/repo",
        json: true,
      },
      {
        execFile: mockExecFile((_cmd, _args, cb) => {
          cb(null, "not-json", "");
        }),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.json).toBeUndefined();
    expect(result.stdout).toBe("not-json");
  });

  it("leaves json undefined when stdout is empty", async () => {
    const result = await runMulchCommand(
      {
        command: "mulch",
        args: ["status"],
        cwd: "/repo",
        json: true,
      },
      {
        execFile: mockExecFile((_cmd, _args, cb) => {
          cb(null, "   ", "");
        }),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.json).toBeUndefined();
  });

  it("handles empty stdout and stderr", async () => {
    const result = await runMulchCommand(
      {
        command: "mulch",
        args: ["init"],
        cwd: "/repo",
      },
      {
        execFile: mockExecFile((_cmd, _args, cb) => {
          cb(null, "", "");
        }),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });
});

describe("formatMulchResult", () => {
  it("formats a successful result", () => {
    const text = formatMulchResult({
      command: "mulch",
      args: ["status"],
      cwd: "/repo",
      exitCode: 0,
      stdout: "3 domains",
      stderr: "",
      ok: true,
    });

    expect(text).toContain("Command: mulch status");
    expect(text).toContain("Exit code: 0");
    expect(text).toContain("3 domains");
  });

  it("formats a failed result with stderr", () => {
    const text = formatMulchResult({
      command: "mulch",
      args: ["search", "bad"],
      cwd: "/repo",
      exitCode: 1,
      stdout: "",
      stderr: "no results",
      ok: false,
    });

    expect(text).toContain("Command: mulch search bad");
    expect(text).toContain("Exit code: 1");
    expect(text).toContain("stderr:");
    expect(text).toContain("no results");
  });

  it("omits empty stdout and stderr sections", () => {
    const text = formatMulchResult({
      command: "mulch",
      args: ["status"],
      cwd: "/repo",
      exitCode: 0,
      stdout: "  ",
      stderr: "",
      ok: true,
    });

    expect(text).toContain("Command: mulch status");
    expect(text).toContain("Exit code: 0");
    expect(text).not.toContain("stderr:");
  });
});
