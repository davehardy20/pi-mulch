import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import type { RunMulchCommandOptions } from "../src/exec.js";
import mulchIntegrationExtension from "../src/index.js";

const tempDirs: string[] = [];
afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

type Command = {
	handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
};

function setup(targetName = ".mulch", withGit = true) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-mulch-sync-"));
	tempDirs.push(root);
	const home = path.join(root, "home");
	const repo = path.join(root, "global-mulch");
	const store = path.join(repo, targetName);
	fs.mkdirSync(home);
	fs.mkdirSync(store, { recursive: true });
	if (withGit) fs.mkdirSync(path.join(repo, ".git"));
	fs.symlinkSync(store, path.join(home, ".mulch"), "dir");
	const calls: RunMulchCommandOptions[] = [];
	const commands = new Map<string, Command>();
	const pi = {
		on: () => undefined,
		registerTool: () => undefined,
		registerCommand: (name: string, def: Command) => commands.set(name, def),
		sendMessage: () => undefined,
	} as unknown as ExtensionAPI;
	mulchIntegrationExtension(pi, {
		detectMulch: () => ({
			cliAvailable: true,
			cliCommand: "ml",
			directoryExists: true,
			directoryPath: path.join(home, ".mulch"),
			globalDirectoryExists: true,
			globalDirectoryPath: path.join(home, ".mulch"),
			globalCommandCwd: home,
			commandCwd: home,
			ready: true,
			isWorktree: false,
			mainWorktreeRoot: null,
			isGitRepo: false,
			gitRepoRoot: null,
		}),
		runMulchCommand: async (options) => {
			calls.push(options);
			return {
				command: "ml",
				args: options.args,
				cwd: options.cwd,
				exitCode: 0,
				stdout: "ok",
				stderr: "",
				ok: true,
			};
		},
	});
	async function run(name = "mulch-sync", args = "") {
		const command = commands.get(name);
		if (!command) throw new Error("Missing command");
		await command.handler(args, {
			cwd: home,
			hasUI: false,
		} as ExtensionCommandContext);
	}
	return { root, home, repo, store, calls, run };
}

describe("global Mulch sync command routing", () => {
	it("syncs the relocated store from its dedicated repo, preserving flags", async () => {
		const { repo, calls, run } = setup();
		await run("mulch-sync", "--no-validate");
		expect(calls[0]?.cwd).toBe(fs.realpathSync(repo));
		expect(calls[0]?.args).toEqual(["sync", "--no-validate"]);
	});

	it("leaves non-sync commands at the global access path", async () => {
		const { home, calls, run } = setup();
		await run("mulch-prune");
		expect(calls[0]?.cwd).toBe(home);
	});

	it("preserves legacy non-symlink stores", async () => {
		const { home, calls, run } = setup();
		fs.unlinkSync(path.join(home, ".mulch"));
		fs.mkdirSync(path.join(home, ".mulch"));
		await run();
		expect(calls[0]?.cwd).toBe(home);
	});

	it.each([
		{ name: "memories", git: true },
		{ name: ".mulch", git: false },
	])("rejects invalid layouts: $name / Git $git", async ({ name, git }) => {
		const { calls, run } = setup(name, git);
		await expect(run()).rejects.toThrow();
		expect(calls).toEqual([]);
	});

	it("rejects broken store links", async () => {
		const { store, calls, run } = setup();
		fs.rmdirSync(store);
		await expect(run()).rejects.toThrow();
		expect(calls).toEqual([]);
	});

	it("rejects symlinked Git metadata", async () => {
		const { root, repo, calls, run } = setup();
		fs.rmdirSync(path.join(repo, ".git"));
		const other = path.join(root, "other-git");
		fs.mkdirSync(other);
		fs.symlinkSync(other, path.join(repo, ".git"), "dir");
		await expect(run()).rejects.toThrow();
		expect(calls).toEqual([]);
	});
});
