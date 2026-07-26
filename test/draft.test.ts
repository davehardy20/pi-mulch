import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_MULCH_CONFIG } from "../src/config.js";
import {
	applyDraftFile,
	findLatestDraft,
	getLatestLinterStatus,
	loadDraftFile,
	maybeWriteSessionDraft,
	writeDraftFile,
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

describe("findLatestDraft", () => {
	it("filters shared global drafts by repository", () => {
		const globalRoot = makeTempDir();
		const repoA = makeTempDir();
		const repoB = makeTempDir();
		const draftsDir = path.join(globalRoot, ".mulch", "drafts");
		fs.mkdirSync(draftsDir, { recursive: true });
		const repoAPath = path.join(draftsDir, "repo-a.json");
		const repoBPath = path.join(draftsDir, "repo-b.json");
		const makeDraft = (repoRoot: string): MulchDraftFile => ({
			version: 1,
			createdAt: new Date().toISOString(),
			repoRoot,
			linterStatus: "clean",
			lastUserPrompt: "test",
			touchedFiles: ["src/index.ts"],
			learn: {},
			records: [],
		});
		fs.writeFileSync(repoAPath, JSON.stringify(makeDraft(repoA)));
		fs.writeFileSync(repoBPath, JSON.stringify(makeDraft(repoB)));
		const now = Date.now() / 1000;
		fs.utimesSync(repoAPath, now - 10, now - 10);
		fs.utimesSync(repoBPath, now, now);

		expect(findLatestDraft(globalRoot, DEFAULT_MULCH_CONFIG, {}, repoA)).toBe(
			repoAPath,
		);
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

	it("writes session drafts under the global Mulch store when available", async () => {
		const repoRoot = makeTempDir();
		const globalRoot = makeTempDir();
		let learnCwd: string | undefined;

		const draftPath = await maybeWriteSessionDraft(
			{
				detection: {
					...readyDetection(repoRoot),
					directoryPath: path.join(globalRoot, ".mulch"),
					globalDirectoryExists: true,
					globalDirectoryPath: path.join(globalRoot, ".mulch"),
					globalCommandCwd: globalRoot,
					commandCwd: globalRoot,
				},
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
			async (options) => {
				learnCwd = options.cwd;
				return {
					command: "mulch",
					args: ["learn"],
					cwd: options.cwd,
					exitCode: 0,
					stdout: '{"suggestedDomains":["extensions"]}',
					stderr: "",
					ok: true,
					json: { suggestedDomains: ["extensions"] },
				};
			},
		);

		expect(learnCwd).toBe(repoRoot);
		expect(
			draftPath?.startsWith(path.join(globalRoot, ".mulch", "drafts")),
		).toBe(true);
		const draft = loadDraftFile(draftPath as string);
		expect(draft.repoRoot).toBe(repoRoot);
		expect(draft.touchedFiles).toEqual([path.join(repoRoot, "src/index.ts")]);
		expect(draft.records[0]?.files).toEqual([
			path.join(repoRoot, "src/index.ts"),
		]);
	});

	it("falls back to the project store when the global store is absent", async () => {
		const repoRoot = makeTempDir();
		const homeRoot = makeTempDir();
		let learnCwd: string | undefined;

		const draftPath = await maybeWriteSessionDraft(
			{
				detection: {
					...readyDetection(repoRoot),
					globalDirectoryExists: false,
					globalDirectoryPath: path.join(homeRoot, ".mulch"),
					globalCommandCwd: homeRoot,
				},
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
			async (options) => {
				learnCwd = options.cwd;
				return {
					command: "mulch",
					args: ["learn"],
					cwd: options.cwd,
					exitCode: 0,
					stdout: '{"suggestedDomains":["extensions"]}',
					stderr: "",
					ok: true,
					json: { suggestedDomains: ["extensions"] },
				};
			},
		);

		expect(learnCwd).toBe(repoRoot);
		expect(draftPath?.startsWith(path.join(repoRoot, ".mulch", "drafts"))).toBe(
			true,
		);
		const draft = loadDraftFile(draftPath as string);
		expect(draft.touchedFiles).toEqual(["src/index.ts"]);
		expect(draft.records[0]?.files).toEqual(["src/index.ts"]);
	});

	it("uses the detected project cwd for linked-worktree learning", async () => {
		const linkedRoot = makeTempDir();
		const mainRoot = makeTempDir();
		let learnCwd: string | undefined;

		const draftPath = await maybeWriteSessionDraft(
			{
				detection: {
					...readyDetection(linkedRoot),
					directoryPath: path.join(mainRoot, ".mulch"),
					commandCwd: mainRoot,
					isWorktree: true,
					mainWorktreeRoot: mainRoot,
					globalDirectoryExists: false,
					globalDirectoryPath: path.join(makeTempDir(), ".mulch"),
					projectDirectoryExists: true,
					projectDirectoryPath: path.join(mainRoot, ".mulch"),
					projectCommandCwd: mainRoot,
				},
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
				touchedFiles: [path.join(linkedRoot, "src/index.ts")],
				lastUserPrompt: "linked worktree change",
			},
			async (options) => {
				learnCwd = options.cwd;
				return {
					command: "mulch",
					args: ["learn"],
					cwd: options.cwd,
					exitCode: 0,
					stdout: "{}",
					stderr: "",
					ok: true,
					json: {},
				};
			},
		);

		expect(learnCwd).toBe(mainRoot);
		expect(draftPath?.startsWith(path.join(mainRoot, ".mulch", "drafts"))).toBe(
			true,
		);
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

	it("qualifies relative record files when applying to the global store", async () => {
		const repoRoot = makeTempDir();
		const globalRoot = makeTempDir();
		const draftPath = path.join(globalRoot, "draft.json");
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
					type: "convention",
					content: "Keep it separate",
					files: ["src/index.ts"],
					placeholder: false,
				},
			],
		};
		fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2));
		let batch: Array<Record<string, unknown>> = [];

		await applyDraftFile(
			draftPath,
			{ command: "mulch", cwd: globalRoot, filePathMode: "absolute" },
			async (options) => {
				batch = JSON.parse(
					fs.readFileSync(options.args[3] as string, "utf8"),
				) as Array<Record<string, unknown>>;
				return {
					command: "mulch",
					args: options.args,
					cwd: options.cwd,
					exitCode: 0,
					stdout: "ok",
					stderr: "",
					ok: true,
				};
			},
		);

		expect(batch[0]?.files).toEqual([path.join(repoRoot, "src/index.ts")]);
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

	it("keeps draft writes inside the repo when draftDir escapes", () => {
		const repoRoot = makeTempDir();
		const draft = {
			version: 1 as const,
			createdAt: new Date().toISOString(),
			repoRoot,
			linterStatus: "clean" as const,
			lastUserPrompt: "ship it",
			touchedFiles: ["src/index.ts"],
			learn: {},
			records: [],
		};

		const filePath = writeDraftFile(
			repoRoot,
			{ ...DEFAULT_MULCH_CONFIG, draftDir: "../outside-drafts" },
			draft,
		);

		expect(filePath.startsWith(path.join(repoRoot, ".mulch", "drafts"))).toBe(
			true,
		);
		expect(fs.existsSync(filePath)).toBe(true);
		expect(fs.existsSync(path.resolve(repoRoot, "../outside-drafts"))).toBe(
			false,
		);
	});

	it("uses unique filenames for simultaneous shared-store drafts", () => {
		const storeRoot = makeTempDir();
		const draft = {
			version: 1 as const,
			createdAt: "2026-07-26T16:36:31.123Z",
			repoRoot: "/repo",
			linterStatus: "clean" as const,
			lastUserPrompt: "ship it",
			touchedFiles: ["/repo/src/index.ts"],
			learn: {},
			records: [],
		};

		const first = writeDraftFile(storeRoot, DEFAULT_MULCH_CONFIG, draft);
		const second = writeDraftFile(storeRoot, DEFAULT_MULCH_CONFIG, draft);

		expect(second).not.toBe(first);
		expect(fs.existsSync(first)).toBe(true);
		expect(fs.existsSync(second)).toBe(true);
	});
});
