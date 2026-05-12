import { describe, expect, it } from "vitest";
import { DEFAULT_MULCH_CONFIG } from "../src/config.js";
import {
	buildPrimeRequest,
	createPrimeInjection,
	shouldInjectPrime,
} from "../src/prime.js";

const detection = {
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
} as const;

describe("buildPrimeRequest", () => {
	it("uses manifest mode with no touched files", () => {
		expect(
			buildPrimeRequest(detection, [], DEFAULT_MULCH_CONFIG),
		).toMatchObject({
			mode: "manifest",
			args: ["prime", "--manifest", "--budget", "4000", "--format", "plain"],
			signature: "manifest:4000",
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
			signature: "files:src/index.ts:4000",
		});
	});
});

describe("createPrimeInjection", () => {
	it("returns prime content and dedupes repeated injections", async () => {
		const injection = await createPrimeInjection(
			{
				detection,
				touchedFiles: [],
				config: DEFAULT_MULCH_CONFIG,
			},
			async () => ({
				command: "mulch",
				args: ["prime"],
				cwd: "/repo",
				exitCode: 0,
				stdout: "manifest text\n",
				stderr: "",
				ok: true,
			}),
		);

		expect(injection).toEqual({
			mode: "manifest",
			signature: "manifest:4000",
			content: "manifest text",
		});
		expect(
			shouldInjectPrime(null, null, injection as NonNullable<typeof injection>),
		).toBe(true);
		expect(
			shouldInjectPrime(
				"manifest:4000",
				"manifest text",
				injection as NonNullable<typeof injection>,
			),
		).toBe(false);
	});

	it("returns null when mulch prime command fails", async () => {
		const injection = await createPrimeInjection(
			{
				detection,
				touchedFiles: [],
				config: DEFAULT_MULCH_CONFIG,
			},
			async () => ({
				command: "mulch",
				args: ["prime", "--manifest"],
				cwd: "/repo",
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
			async () => ({
				command: "mulch",
				args: ["prime", "--manifest"],
				cwd: "/repo",
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
				detection: {
					cliAvailable: true,
					cliCommand: "mulch",
					directoryExists: false,
					directoryPath: "/repo/.mulch",
					isWorktree: false,
					mainWorktreeRoot: null,
					isGitRepo: true,
					gitRepoRoot: "/repo",
					commandCwd: "/repo",
					ready: false,
				},
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
