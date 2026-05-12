import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { generateDrafts, listDrafts, getDraft, markDraftApplied, deleteDraft } from "../src/draft.js";
import { runMulch } from "../src/exec.js";

vi.mock("../src/exec.js", () => ({
  runMulch: vi.fn(),
}));

const TEST_CWD = "/tmp/pi-mulch-test";

beforeEach(() => {
  // Clean test directory
  try {
    fs.rmSync(TEST_CWD, { recursive: true });
  } catch {
    // ignore
  }
  fs.mkdirSync(path.join(TEST_CWD, ".mulch", "drafts"), { recursive: true });
});

describe("generateDrafts", () => {
  it("creates draft files in .mulch/drafts/", async () => {
    vi.mocked(runMulch).mockResolvedValue({
      stdout: JSON.stringify({ suggestedDomains: [{ domain: "frontend" }] }),
      stderr: "",
      code: 0,
    });

    const drafts = await generateDrafts(
      "mulch",
      ["src/index.ts"],
      TEST_CWD,
      {
        enabled: true,
        command: "mulch",
        injectionMode: "manifest",
        injectionBudget: 4000,
        suppressInitPrompt: true,
        draftMode: "auto",
        autoLearnDomains: ["general"],
      },
    );

    expect(drafts.length).toBeGreaterThan(0);
    expect(drafts[0].domain).toBe("frontend");
    expect(drafts[0].files).toEqual(["src/index.ts"]);
  });

  it("falls back to autoLearnDomains when learn has no suggestions", async () => {
    vi.mocked(runMulch).mockResolvedValue({
      stdout: JSON.stringify({ suggestedDomains: [] }),
      stderr: "",
      code: 0,
    });

    const drafts = await generateDrafts(
      "mulch",
      ["src/index.ts"],
      TEST_CWD,
      {
        enabled: true,
        command: "mulch",
        injectionMode: "manifest",
        injectionBudget: 4000,
        suppressInitPrompt: true,
        draftMode: "auto",
        autoLearnDomains: ["general"],
      },
    );

    expect(drafts.length).toBeGreaterThan(0);
    expect(drafts[0].domain).toBe("general");
  });

  it("returns empty array when no files provided", async () => {
    const drafts = await generateDrafts("mulch", [], TEST_CWD, {
      enabled: true,
      command: "mulch",
      injectionMode: "manifest",
      injectionBudget: 4000,
      suppressInitPrompt: true,
      draftMode: "auto",
      autoLearnDomains: ["general"],
    });
    expect(drafts).toEqual([]);
  });
});

describe("listDrafts", () => {
  it("returns unapplied drafts sorted by date", () => {
    const d1 = { id: "d1", domain: "a", type: "convention", files: [], createdAt: "2024-01-01T00:00:00Z", applied: false };
    const d2 = { id: "d2", domain: "b", type: "convention", files: [], createdAt: "2024-01-02T00:00:00Z", applied: false };
    const d3 = { id: "d3", domain: "c", type: "convention", files: [], createdAt: "2024-01-03T00:00:00Z", applied: true };

    fs.writeFileSync(path.join(TEST_CWD, ".mulch/drafts/d1.json"), JSON.stringify(d1));
    fs.writeFileSync(path.join(TEST_CWD, ".mulch/drafts/d2.json"), JSON.stringify(d2));
    fs.writeFileSync(path.join(TEST_CWD, ".mulch/drafts/d3.json"), JSON.stringify(d3));

    const drafts = listDrafts(TEST_CWD);
    expect(drafts.length).toBe(2);
    expect(drafts[0].id).toBe("d2");
    expect(drafts[1].id).toBe("d1");
  });

  it("returns empty array when no drafts dir", () => {
    fs.rmSync(path.join(TEST_CWD, ".mulch"), { recursive: true });
    expect(listDrafts(TEST_CWD)).toEqual([]);
  });
});

describe("getDraft", () => {
  it("retrieves a draft by id", () => {
    const draft = { id: "x", domain: "a", type: "convention", files: [], createdAt: "2024-01-01T00:00:00Z", applied: false };
    fs.writeFileSync(path.join(TEST_CWD, ".mulch/drafts/x.json"), JSON.stringify(draft));
    expect(getDraft(TEST_CWD, "x")?.id).toBe("x");
  });

  it("returns null for missing draft", () => {
    expect(getDraft(TEST_CWD, "missing")).toBeNull();
  });
});

describe("markDraftApplied", () => {
  it("marks a draft as applied", () => {
    const draft = { id: "x", domain: "a", type: "convention", files: [], createdAt: "2024-01-01T00:00:00Z", applied: false };
    fs.writeFileSync(path.join(TEST_CWD, ".mulch/drafts/x.json"), JSON.stringify(draft));
    markDraftApplied(TEST_CWD, "x");
    const updated = getDraft(TEST_CWD, "x");
    expect(updated?.applied).toBe(true);
  });
});

describe("deleteDraft", () => {
  it("removes a draft file", () => {
    const draft = { id: "x", domain: "a", type: "convention", files: [], createdAt: "2024-01-01T00:00:00Z", applied: false };
    fs.writeFileSync(path.join(TEST_CWD, ".mulch/drafts/x.json"), JSON.stringify(draft));
    deleteDraft(TEST_CWD, "x");
    expect(getDraft(TEST_CWD, "x")).toBeNull();
  });
});
