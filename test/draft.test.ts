import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_MULCH_CONFIG } from "../src/config.js";
import {
	applyDraftFile,
	getLatestLinterStatus,
	loadDraftFile,
	maybeWriteSessionDraft,
} from "../src/draft.js";
import type { MulchDraftFile } from "../src/types.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-mulch-draft-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

function readyDetection(repoRoot: string) {
	return {
		cliAvailable: true,
		cliCommand: "mulch",
		directoryExists: true,
		directoryPath: path.join(repoRoot, ".mulch"),
		isWorktree: false,
		mainWorktreeRoot: null,
		isGitRepo: true,
		gitRepoRoot: repoRoot,
		commandCwd: repoRoot,
		ready: true,
	};
}

describe("getLatestLinterStatus", () => {
	it("prefers the latest clean status message", () => {
		expect(
			getLatestLinterStatus([
				{
					type: "custom_message",
					customType: "post-turn-linter-status",
					details: { status: "clean" },
				},
			] as never),
		).toBe("clean");

		expect(
			getLatestLinterStatus([
				{
					type: "custom_message",
					customType: "post-turn-linter",
					content: "findings",
				},
			] as never),
		).toBe("findings");
	});
});

describe("maybeWriteSessionDraft", () => {
	it("writes a draft only after a clean linter status", async () => {
		const repoRoot = makeTempDir();
		const draftPath = await maybeWriteSessionDraft(
			{
				detection: readyDetection(repoRoot),
				config: DEFAULT_MULCH_CONFIG,
				sessionManager: {
					getEntries: () => [
						{
							type: "custom_message",
							customType: "post-turn-linter-status",
							details: { status: "clean" },
						},
					],
				} as never,
				touchedFiles: [path.join(repoRoot, "src/index.ts")],
				lastUserPrompt: "implement feature",
			},
			async () => ({
				command: "mulch",
				args: ["learn"],
				cwd: repoRoot,
				exitCode: 0,
				stdout: '{"suggestedDomains":["extensions"]}',
				stderr: "",
				ok: true,
				json: { suggestedDomains: ["extensions"] },
			}),
		);

		expect(draftPath).toBeTruthy();
		const draft = loadDraftFile(draftPath as string);
		expect(draft.records[0]).toMatchObject({
			domain: "extensions",
			placeholder: true,
		});

		const skipped = await maybeWriteSessionDraft(
			{
				detection: readyDetection(repoRoot),
				config: DEFAULT_MULCH_CONFIG,
				sessionManager: {
					getEntries: () => [
						{
							type: "custom_message",
							customType: "post-turn-linter",
							content: "findings",
						},
					],
				} as never,
				touchedFiles: [path.join(repoRoot, "src/index.ts")],
				lastUserPrompt: "implement feature",
			},
			async () => {
				throw new Error("should not run learn");
			},
		);

		expect(skipped).toBeNull();
	});
});

describe("applyDraftFile", () => {
	it("applies only actionable records and persists apply results", async () => {
		const repoRoot = makeTempDir();
		const draftsDir = path.join(repoRoot, ".mulch", "drafts");
		fs.mkdirSync(draftsDir, { recursive: true });
		const draftPath = path.join(draftsDir, "draft.json");
		const draft: MulchDraftFile = {
			version: 1,
			createdAt: new Date().toISOString(),
			repoRoot,
			linterStatus: "clean",
			lastUserPrompt: "ship it",
			touchedFiles: ["src/index.ts"],
			learn: {},
			records: [
				{
					domain: "extensions",
					type: "guide",
					name: "Mulch package",
					description: "Keep it separate",
					files: ["src/index.ts"],
					placeholder: false,
				},
				{
					domain: "extensions",
					type: "guide",
					name: "Placeholder",
					description: "skip me",
					placeholder: true,
				},
			],
		};
		fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2));

		const seenArgs: string[][] = [];
		const applied = await applyDraftFile(
			draftPath,
			{ command: "mulch", cwd: repoRoot },
			async (options) => {
				seenArgs.push(options.args);
				return {
					command: "mulch",
					args: options.args,
					cwd: repoRoot,
					exitCode: 0,
					stdout: "ok",
					stderr: "",
					ok: true,
				};
			},
		);

		expect(seenArgs).toHaveLength(1);
		expect(seenArgs[0]?.slice(0, 3)).toEqual([
			"record",
			"extensions",
			"--batch",
		]);
		expect(applied.draft.applyResults).toEqual([
			{ domain: "extensions", appliedCount: 1 },
		]);
		expect(loadDraftFile(draftPath).appliedAt).toBeTruthy();
	});

	it("includes failed results when mulch record command errors", async () => {
		const repoRoot = makeTempDir();
		const draftsDir = path.join(repoRoot, ".mulch", "drafts");
		fs.mkdirSync(draftsDir, { recursive: true });
		const draftPath = path.join(draftsDir, "draft.json");
		const draft: MulchDraftFile = {
			version: 1,
			createdAt: new Date().toISOString(),
			repoRoot,
			linterStatus: "clean",
			lastUserPrompt: "ship it",
			touchedFiles: ["src/index.ts"],
			learn: {},
			records: [
				{
					domain: "extensions",
					type: "guide",
					name: "Mulch package",
					description: "Keep it separate",
					files: ["src/index.ts"],
					placeholder: false,
				},
			],
		};
		fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2));

		const applied = await applyDraftFile(
			draftPath,
			{ command: "mulch", cwd: repoRoot },
			async (options) => ({
				command: options.command ?? "mulch",
				args: options.args,
				cwd: repoRoot,
				exitCode: 1,
				stdout: "",
				stderr: "record failed",
				ok: false,
			}),
		);

		expect(applied.results).toHaveLength(1);
		expect(applied.results[0]?.ok).toBe(false);
		expect(applied.results[0]?.stderr).toBe("record failed");
		// applyResults should not include the failed domain
		expect(applied.draft.applyResults).toEqual([]);
		// But appliedAt should still be set (best-effort)
		expect(applied.draft.appliedAt).toBeTruthy();
	});
});

describe("maybeWriteSessionDraft safety", () => {
	it("returns null when detection is null", async () => {
		const result = await maybeWriteSessionDraft(
			{
				detection: null,
				config: DEFAULT_MULCH_CONFIG,
				sessionManager: { getEntries: () => [] },
				touchedFiles: ["/repo/src/index.ts"],
				lastUserPrompt: "do stuff",
			},
			async () => {
				throw new Error("should not run");
			},
		);
		expect(result).toBeNull();
	});

	it("returns null when cliCommand is null", async () => {
		const result = await maybeWriteSessionDraft(
			{
				detection: {
					cliAvailable: false,
					cliCommand: null,
					directoryExists: true,
					directoryPath: "/repo/.mulch",
					isWorktree: false,
					mainWorktreeRoot: null,
					isGitRepo: true,
					gitRepoRoot: "/repo",
					commandCwd: "/repo",
					ready: false,
				},
				config: DEFAULT_MULCH_CONFIG,
				sessionManager: { getEntries: () => [] },
				touchedFiles: ["/repo/src/index.ts"],
				lastUserPrompt: "do stuff",
			},
			async () => {
				throw new Error("should not run");
			},
		);
		expect(result).toBeNull();
	});

	it("returns null when learn command fails", async () => {
		const repoRoot = makeTempDir();
		const result = await maybeWriteSessionDraft(
			{
				detection: readyDetection(repoRoot),
				config: DEFAULT_MULCH_CONFIG,
				sessionManager: {
					getEntries: () => [
						{
							type: "custom_message",
							customType: "post-turn-linter-status",
							details: { status: "clean" },
						},
					],
				} as never,
				touchedFiles: [path.join(repoRoot, "src/index.ts")],
				lastUserPrompt: "implement feature",
			},
			async () => ({
				command: "mulch",
				args: ["learn"],
				cwd: repoRoot,
				exitCode: 1,
				stdout: "",
				stderr: "learn failed",
				ok: false,
			}),
		);

		expect(result).toBeNull();
	});

	it("returns null when detection is ready but gitRepoRoot is null", async () => {
		const result = await maybeWriteSessionDraft(
			{
				detection: {
					cliAvailable: true,
					cliCommand: "mulch",
					directoryExists: true,
					directoryPath: "/repo/.mulch",
					isWorktree: false,
					mainWorktreeRoot: null,
					isGitRepo: false,
					gitRepoRoot: null,
					commandCwd: "/repo",
					ready: true,
				},
				config: DEFAULT_MULCH_CONFIG,
				sessionManager: { getEntries: () => [] },
				touchedFiles: ["/repo/src/index.ts"],
				lastUserPrompt: "do stuff",
			},
			async () => {
				throw new Error("should not run");
			},
		);
		expect(result).toBeNull();
	});

	it("returns null when draftMode is off", async () => {
		const result = await maybeWriteSessionDraft(
			{
				detection: {
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
				},
				config: { ...DEFAULT_MULCH_CONFIG, draftMode: "off" },
				sessionManager: { getEntries: () => [] },
				touchedFiles: ["/repo/src/index.ts"],
				lastUserPrompt: "do stuff",
			},
			async () => {
				throw new Error("should not run");
			},
		);
		expect(result).toBeNull();
	});

	it("returns null when no touched files exist", async () => {
		const result = await maybeWriteSessionDraft(
			{
				detection: {
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
				},
				config: DEFAULT_MULCH_CONFIG,
				sessionManager: { getEntries: () => [] },
				touchedFiles: [],
				lastUserPrompt: "do stuff",
			},
			async () => {
				throw new Error("should not run");
			},
		);
		expect(result).toBeNull();
	});

	it("returns null when linter status has findings", async () => {
		const repoRoot = makeTempDir();
		const result = await maybeWriteSessionDraft(
			{
				detection: readyDetection(repoRoot),
				config: DEFAULT_MULCH_CONFIG,
				sessionManager: {
					getEntries: () => [
						{
							type: "custom_message",
							customType: "post-turn-linter-status",
							details: { status: "findings" },
						},
					],
				} as never,
				touchedFiles: [path.join(repoRoot, "src/index.ts")],
				lastUserPrompt: "implement feature",
			},
			async () => {
				throw new Error("should not run");
			},
		);
		expect(result).toBeNull();
	});

	it("returns null when linter status has error", async () => {
		const repoRoot = makeTempDir();
		const result = await maybeWriteSessionDraft(
			{
				detection: readyDetection(repoRoot),
				config: DEFAULT_MULCH_CONFIG,
				sessionManager: {
					getEntries: () => [
						{
							type: "custom_message",
							customType: "post-turn-linter-status",
							details: { status: "error" },
						},
					],
				} as never,
				touchedFiles: [path.join(repoRoot, "src/index.ts")],
				lastUserPrompt: "implement feature",
			},
			async () => {
				throw new Error("should not run");
			},
		);
		expect(result).toBeNull();
	});

	it("returns null when touched files are outside repo root", async () => {
		const repoRoot = makeTempDir();
		const result = await maybeWriteSessionDraft(
			{
				detection: readyDetection(repoRoot),
				config: DEFAULT_MULCH_CONFIG,
				sessionManager: {
					getEntries: () => [
						{
							type: "custom_message",
							customType: "post-turn-linter-status",
							details: { status: "clean" },
						},
					],
				} as never,
				touchedFiles: ["/other-repo/src/index.ts"],
				lastUserPrompt: "implement feature",
			},
			async () => {
				throw new Error("should not run");
			},
		);
		expect(result).toBeNull();
	});
});
