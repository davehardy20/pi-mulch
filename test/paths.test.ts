import { describe, expect, it } from "vitest";
import {
	createTouchedFileTracker,
	extractPathsFromBashCommand,
	extractPathsFromToolCall,
	extractPathsFromToolResultDetails,
	normalizeInputPath,
} from "../src/paths.js";

describe("normalizeInputPath", () => {
	it("normalizes absolute, relative, and file URI paths", () => {
		expect(normalizeInputPath("/foo//bar/")).toBe("/foo/bar");
		expect(normalizeInputPath("src/index.ts", "/repo")).toBe(
			"/repo/src/index.ts",
		);
		expect(normalizeInputPath("file:///tmp/example.ts")).toBe(
			"/tmp/example.ts",
		);
	});
});

describe("createTouchedFileTracker", () => {
	it("deduplicates equivalent paths", () => {
		const tracker = createTouchedFileTracker();
		tracker.add("src/index.ts", "/repo");
		tracker.add("/repo/src//index.ts");
		expect(tracker.size).toBe(1);
		expect(tracker.getAll()).toEqual(["/repo/src/index.ts"]);
	});
});

describe("extractPathsFromToolCall", () => {
	it("reads built-in tool paths and nested custom fields", () => {
		expect(
			extractPathsFromToolCall({
				type: "tool_call",
				toolCallId: "1",
				toolName: "read",
				input: { path: "README.md" },
			} as never),
		).toEqual(["README.md"]);

		expect(
			extractPathsFromToolCall({
				type: "tool_call",
				toolCallId: "2",
				toolName: "lsp_apply",
				input: {
					filePaths: ["src/a.ts", "src/b.ts"],
					edit: { newUri: "file:///tmp/generated.ts" },
				},
			} as never),
		).toEqual(["src/a.ts", "src/b.ts", "file:///tmp/generated.ts"]);
	});
});

describe("extractPathsFromToolResultDetails", () => {
	it("collects modifiedFiles and nested path-like keys", () => {
		expect(
			extractPathsFromToolResultDetails({
				modifiedFiles: ["src/main.ts"],
				details: { newPath: "src/next.ts" },
			}),
		).toEqual(["src/main.ts", "src/next.ts"]);
	});
});

describe("extractPathsFromBashCommand", () => {
	it("finds file arguments conservatively", () => {
		expect(
			extractPathsFromBashCommand('cat "path with spaces/file.txt"'),
		).toEqual(["path with spaces/file.txt"]);
		expect(extractPathsFromBashCommand("echo hi > output.txt")).toEqual([
			"output.txt",
		]);
		expect(extractPathsFromBashCommand("git diff HEAD")).toEqual([]);
	});
});
