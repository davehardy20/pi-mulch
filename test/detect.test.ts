import { describe, it, expect, vi } from "vitest";
import { detectMulch } from "../src/detect.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn((cmd: string) => {
    if (cmd.includes("--version")) {
      if (cmd.startsWith("mulch") || cmd.startsWith("ml ")) {
        return "0.9.0\n";
      }
      throw new Error("not found");
    }
    return "";
  }),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn((p: string) => p.includes(".mulch")),
}));

describe("detectMulch", () => {
  it("detects CLI and .mulch/ when both exist", () => {
    const result = detectMulch("/project", "mulch");
    expect(result.cliAvailable).toBe(true);
    expect(result.dotMulchExists).toBe(true);
    expect(result.version).toBe("0.9.0");
  });

  it("falls back to ml when mulch is not found", () => {
    const result = detectMulch("/project", "not-mulch");
    expect(result.cliAvailable).toBe(true);
    expect(result.cliCommand).toBe("mulch");
  });
});
