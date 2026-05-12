import { describe, it, expect, vi } from "vitest";
import { getManifestPrime, getScopedPrime, buildPrimeMessage } from "../src/prime.js";
import { runMulch } from "../src/exec.js";

vi.mock("../src/exec.js", () => ({
  runMulch: vi.fn(),
}));

describe("getManifestPrime", () => {
  it("returns null when mulch prime --manifest fails", async () => {
    vi.mocked(runMulch).mockResolvedValue({ stdout: "", stderr: "error", code: 1 });
    const result = await getManifestPrime("mulch", "/project");
    expect(result).toBeNull();
  });

  it("returns prime result on success", async () => {
    vi.mocked(runMulch).mockResolvedValue({ stdout: "  manifest content  ", stderr: "", code: 0 });
    const result = await getManifestPrime("mulch", "/project");
    expect(result).not.toBeNull();
    expect(result?.content).toBe("manifest content");
    expect(result?.mode).toBe("manifest");
    expect(result?.hash).toBeDefined();
  });
});

describe("getScopedPrime", () => {
  it("passes files and budget to mulch prime", async () => {
    vi.mocked(runMulch).mockResolvedValue({ stdout: "scoped content", stderr: "", code: 0 });
    const result = await getScopedPrime("mulch", ["a.ts", "b.ts"], "/project", {
      enabled: true,
      command: "mulch",
      injectionMode: "auto",
      injectionBudget: 2000,
      suppressInitPrompt: true,
      draftMode: "auto",
      autoLearnDomains: ["general"],
    });
    expect(runMulch).toHaveBeenCalledWith(
      "mulch",
      ["prime", "--compact", "--files", "a.ts", "b.ts", "--budget", "2000"],
      "/project",
      undefined,
    );
    expect(result?.content).toBe("scoped content");
    expect(result?.mode).toBe("scoped");
  });
});

describe("buildPrimeMessage", () => {
  it("formats prime result as hidden message content", () => {
    const msg = buildPrimeMessage({ content: "test", hash: "123", mode: "manifest" });
    expect(msg).toContain("## Mulch Context");
    expect(msg).toContain("Mode: manifest");
    expect(msg).toContain("test");
  });
});
