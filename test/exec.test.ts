import { describe, it, expect, vi } from "vitest";
import { normalizeFilePath, runMulch } from "../src/exec.js";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(
    (_cmd: string, _args: string[], _opts: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      callback(null, "mock output", "");
    },
  ),
}));

describe("normalizeFilePath", () => {
  it("resolves relative paths against cwd", () => {
    expect(normalizeFilePath("src/index.ts", "/project")).toBe("/project/src/index.ts");
  });

  it("returns null for undefined", () => {
    expect(normalizeFilePath(undefined, "/project")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalizeFilePath("", "/project")).toBeNull();
  });
});

describe("runMulch", () => {
  it("returns stdout on success", async () => {
    const result = await runMulch("mulch", ["status"], "/project");
    expect(result.stdout).toBe("mock output");
    expect(result.code).toBe(0);
  });
});
