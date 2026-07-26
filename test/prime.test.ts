import { describe, expect, it } from "vitest";
import { DEFAULT_MULCH_CONFIG } from "../src/config.js";
import type { MulchDetectionResult } from "../src/detect.js";
import {
	buildPrimeRequest,
	createPrimeInjection,
	shouldInjectPrime,
} from "../src/prime.js";

const detection: MulchDetectionResult = {
	cliAvailable: true,
	cliCommand: "mulch",
	directoryExists: true,
	directoryPath: "/home/user/.mulch",
	globalDirectoryExists: true,
	globalDirectoryPath: "/home/user/.mulch",
	globalCommandCwd: "/home/user",
	projectDirectoryExists: true,
	projectDirectoryPath: "/repo/.mulch",
	projectCommandCwd: "/repo",
	isWorktree: false,
	mainWorktreeRoot: null,
	isGitRepo: true,
	gitRepoRoot: "/repo",
	commandCwd: "/home/user",
	ready: true,
};

function detectionWith(
	overrides: Partial<MulchDetectionResult>,
): MulchDetectionResult {
	return { ...detection, ...overrides };
}

describe("buildPrimeRequest", () => {
	it("uses manifest mode with no touched files", () => {
		expect(
			buildPrimeRequest(detection, [], DEFAULT_MULCH_CONFIG),
		).toMatchObject({
			mode: "manifest",
			args: ["prime", "--manifest", "--budget", "4000", "--format", "plain"],
			signature: "primary:manifest:4000",
		});
	});

	it("uses file-scoped prime when touched files exist", () => {
		expect(
			buildPrimeRequest(
				detection,
				["/repo/src/index.ts"],
				DEFAULT_MULCH_CONFIG,
			),
		).toMatchObject({
			mode: "files",
			args: [
				"prime",
				"--files",
				"src/index.ts",
				"--budget",
				"4000",
				"--format",
				"plain",
			],
			signature: "primary:files:src/index.ts:4000",
		});
	});

	it("uses absolute file paths for the global store", () => {
		expect(
			buildPrimeRequest(
				detection,
				["/repo/src/index.ts"],
				DEFAULT_MULCH_CONFIG,
				{
					kind: "global",
					label: "Global Mulch memories (~/.mulch)",
					directoryPath: "/home/user/.mulch",
					commandCwd: "/home/user",
				},
			),
		).toMatchObject({
			mode: "files",
			args: [
				"prime",
				"--files",
				"/repo/src/index.ts",
				"--budget",
				"4000",
				"--format",
				"plain",
			],
			signature: "global:files:/repo/src/index.ts:4000",
		});
	});

	it("uses the detected working directory for non-Git global priming", () => {
		const nonGitDetection = detectionWith({
			isGitRepo: false,
			gitRepoRoot: null,
			workingDirectory: "/workspace/project",
			projectDirectoryExists: false,
			projectDirectoryPath: "/workspace/project/.mulch",
			projectCommandCwd: "/workspace/project",
		});

		expect(
			buildPrimeRequest(
				nonGitDetection,
				["/workspace/project/src/index.ts"],
				DEFAULT_MULCH_CONFIG,
				{
					kind: "global",
					label: "Global Mulch memories (~/.mulch)",
					directoryPath: "/home/user/.mulch",
					commandCwd: "/home/user",
				},
			),
		).toMatchObject({
			mode: "files",
			scopedFiles: ["/workspace/project/src/index.ts"],
		});
	});

	it("rejects traversal paths outside the repository for every scope", () => {
		const traversalPath = "/repo/../outside.ts";
		const projectRequest = buildPrimeRequest(
			detection,
			[traversalPath],
			DEFAULT_MULCH_CONFIG,
			{
				kind: "project",
				label: "Repository-specific Mulch memories (.mulch)",
				directoryPath: "/repo/.mulch",
				commandCwd: "/repo",
			},
		);
		const globalRequest = buildPrimeRequest(
			detection,
			[traversalPath],
			DEFAULT_MULCH_CONFIG,
			{
				kind: "global",
				label: "Global Mulch memories (~/.mulch)",
				directoryPath: "/home/user/.mulch",
				commandCwd: "/home/user",
			},
		);

		expect(projectRequest).toMatchObject({ mode: "manifest", scopedFiles: [] });
		expect(globalRequest).toMatchObject({ mode: "manifest", scopedFiles: [] });
	});
});

describe("createPrimeInjection", () => {
	it("returns combined global and project prime content", async () => {
		const calls: string[] = [];
		const injection = await createPrimeInjection(
			{
				detection,
				touchedFiles: [],
				config: DEFAULT_MULCH_CONFIG,
			},
			async (options) => {
				calls.push(options.cwd);
				return {
					command: "mulch",
					args: options.args,
					cwd: options.cwd,
					exitCode: 0,
					stdout: `${options.cwd} manifest text\n`,
					stderr: "",
					ok: true,
				};
			},
		);

		expect(calls).toEqual(["/home/user", "/repo"]);
		expect(injection).toEqual({
			mode: "manifest",
			signature: "global:manifest:4000|project:manifest:4000",
			content:
				"## Global Mulch memories (~/.mulch)\n\n/home/user manifest text\n\n---\n\n" +
				"## Repository-specific Mulch memories (.mulch)\n\n/repo manifest text",
		});
		expect(
			shouldInjectPrime(null, null, injection as NonNullable<typeof injection>),
		).toBe(true);
		expect(
			shouldInjectPrime(
				"global:manifest:4000|project:manifest:4000",
				"## Global Mulch memories (~/.mulch)\n\n/home/user manifest text\n\n---\n\n" +
					"## Repository-specific Mulch memories (.mulch)\n\n/repo manifest text",
				injection as NonNullable<typeof injection>,
			),
		).toBe(false);
	});

	it("returns null when all mulch prime commands fail", async () => {
		const injection = await createPrimeInjection(
			{
				detection,
				touchedFiles: [],
				config: DEFAULT_MULCH_CONFIG,
			},
			async (options) => ({
				command: "mulch",
				args: options.args,
				cwd: options.cwd,
				exitCode: 1,
				stdout: "",
				stderr: "error: prime failed",
				ok: false,
			}),
		);

		expect(injection).toBeNull();
	});

	it("returns null when mulch prime returns empty output", async () => {
		const injection = await createPrimeInjection(
			{
				detection,
				touchedFiles: [],
				config: DEFAULT_MULCH_CONFIG,
			},
			async (options) => ({
				command: "mulch",
				args: options.args,
				cwd: options.cwd,
				exitCode: 0,
				stdout: "   \n  ",
				stderr: "",
				ok: true,
			}),
		);

		expect(injection).toBeNull();
	});

	it("returns null when detection is not ready", async () => {
		const injection = await createPrimeInjection(
			{
				detection: detectionWith({ ready: false, directoryExists: false }),
				touchedFiles: [],
				config: DEFAULT_MULCH_CONFIG,
			},
			async () => {
				throw new Error("should not be called");
			},
		);

		expect(injection).toBeNull();
	});

	it("returns null when cliCommand is null", async () => {
		const injection = await createPrimeInjection(
			{
				detection: detectionWith({
					cliAvailable: false,
					cliCommand: null,
					ready: false,
				}),
				touchedFiles: [],
				config: DEFAULT_MULCH_CONFIG,
			},
			async () => {
				throw new Error("should not be called");
			},
		);

		expect(injection).toBeNull();
	});
});
