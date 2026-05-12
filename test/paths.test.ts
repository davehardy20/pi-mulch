import { describe, it, expect } from "vitest";
import {
  detectTouchedFilesFromToolEvent,
  detectTouchedFilesFromToolResult,
} from "../src/paths.js";

describe("detectTouchedFilesFromToolEvent", () => {
  it("tracks read tool paths", () => {
    const files = detectTouchedFilesFromToolEvent(
      { toolName: "read", args: { path: "src/index.ts" } },
      "/project",
    );
    expect(files).toEqual(["/project/src/index.ts"]);
  });

  it("tracks write tool paths", () => {
    const files = detectTouchedFilesFromToolEvent(
      { toolName: "write", args: { path: "README.md" } },
      "/project",
    );
    expect(files).toEqual(["/project/README.md"]);
  });

  it("tracks edit tool paths", () => {
    const files = detectTouchedFilesFromToolEvent(
      { toolName: "edit", args: { path: "src/utils.ts" } },
      "/project",
    );
    expect(files).toEqual(["/project/src/utils.ts"]);
  });

  it("tracks hashline_edit with rename", () => {
    const files = detectTouchedFilesFromToolEvent(
      { toolName: "hashline_edit", args: { filePath: "old.ts", rename: "new.ts" } },
      "/project",
    );
    expect(files).toEqual(["/project/old.ts", "/project/new.ts"]);
  });

  it("tracks lsp_rename paths", () => {
    const files = detectTouchedFilesFromToolEvent(
      { toolName: "lsp_rename", args: { filePath: "src/main.ts" } },
      "/project",
    );
    expect(files).toEqual(["/project/src/main.ts"]);
  });

  it("tracks ast_grep_replace paths", () => {
    const files = detectTouchedFilesFromToolEvent(
      { toolName: "ast_grep_replace", args: { paths: ["a.ts", "b.ts"] } },
      "/project",
    );
    expect(files).toEqual(["/project/a.ts", "/project/b.ts"]);
  });

  it("ignores unknown tools", () => {
    const files = detectTouchedFilesFromToolEvent(
      { toolName: "bash", args: { command: "echo hi" } },
      "/project",
    );
    expect(files).toEqual([]);
  });

  it("returns empty for missing path", () => {
    const files = detectTouchedFilesFromToolEvent(
      { toolName: "write", args: {} },
      "/project",
    );
    expect(files).toEqual([]);
  });
});

describe("detectTouchedFilesFromToolResult", () => {
  it("reads modifiedFiles from shared contract", () => {
    const files = detectTouchedFilesFromToolResult(
      {
        toolName: "write",
        result: {
          details: { modifiedFiles: ["src/a.ts", "src/b.ts"] },
        },
      },
      "/project",
    );
    expect(files).toEqual(["/project/src/a.ts", "/project/src/b.ts"]);
  });

  it("falls back to lsp_rename changes", () => {
    const files = detectTouchedFilesFromToolResult(
      {
        toolName: "lsp_rename",
        result: {
          details: {
            edit: {
              changes: {
                "file:///project/src/main.ts": [],
              },
            },
          },
        },
      },
      "/project",
    );
    expect(files).toEqual(["/project/src/main.ts"]);
  });

  it("returns null for unhandled tools", () => {
    const files = detectTouchedFilesFromToolResult(
      { toolName: "bash", result: {} },
      "/project",
    );
    expect(files).toBeNull();
  });
});
