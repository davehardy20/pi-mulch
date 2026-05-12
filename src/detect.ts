/**
 * Mulch CLI and `.mulch/` detection
 *
 * Provides functions to detect:
 * - Whether the Mulch CLI (`mulch` / `ml`) is available on PATH
 * - Which command alias to prefer
 * - Whether a `.mulch/` directory exists in the project root
 * - The installed CLI version
 * - The resolved binary path and git repo root
 *
 * All detection functions are pure — they accept explicit arguments and
 * never read global state. This makes them straightforward to unit-test.
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import type { MulchDetection } from "./types.js";

// ── Internals ──────────────────────────────────────────────────────────

/**
 * Probe whether a command exists and is executable on PATH.
 * Returns `true` when `command --version` exits with code 0.
 */
async function commandExists(command: string): Promise<boolean> {
	return new Promise((resolve) => {
		const child = execFile(command, ["--version"], {
			timeout: 5000,
		});
		child.on("error", () => resolve(false));
		child.on("exit", (code) => resolve(code === 0));
	});
}

/**
 * Run `command --version` and return the parsed semver string.
 * Returns `undefined` on any failure.
 */
async function getVersion(command: string): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile(command, ["--version"], { timeout: 5000 }, (err, stdout) => {
			if (err) {
				resolve(undefined);
				return;
			}
			// mulch outputs: "mulch v0.9.0 — ..." or just "v0.9.0"
			const match = (stdout ?? "").match(/v?(\d+\.\d+\.\d+)/);
			resolve(match?.[1] ?? (stdout?.trim() || undefined));
		});
	});
}

/**
 * Check that a `.mulch/` directory exists at `dir`.
 * Returns `true` only when the path exists and is a directory.
 */
async function dotMulchDirExists(dir: string): Promise<boolean> {
	try {
		const s = await stat(join(dir, ".mulch"));
		return s.isDirectory();
	} catch {
		return false;
	}
}

/**
 * Resolve the absolute path to a CLI binary using `which`.
 * Falls back to the bare command name if resolution fails.
 */
async function resolveCommandPath(command: string): Promise<string> {
	return new Promise((resolve) => {
		execFile("which", [command], { timeout: 3000 }, (err, stdout) => {
			if (err || !stdout?.trim()) {
				resolve(command);
				return;
			}
			resolve(stdout.trim());
		});
	});
}

/**
 * Resolve the git root for `cwd`. Falls back to `cwd` itself.
 */
async function resolveGitRoot(cwd: string): Promise<string> {
	return new Promise((resolve) => {
		execFile(
			"git",
			["rev-parse", "--show-toplevel"],
			{ timeout: 3000, cwd },
			(err, stdout) => {
				if (err || !stdout?.trim()) {
					resolve(cwd);
					return;
				}
				resolve(stdout.trim());
			},
		);
	});
}

// ── Public API ─────────────────────────────────────────────────────────

/** Ordered list of CLI command aliases to probe, in preference order. */
export const CLI_CANDIDATES = ["mulch", "ml"] as const;

/**
 * Resolve the best available Mulch CLI command.
 *
 * Probes each candidate in order and returns the first one that responds
 * to `--version` with exit code 0. If none succeed, returns `undefined`.
 */
export async function resolveCliCommand(
	candidates: readonly string[] = CLI_CANDIDATES,
): Promise<string | undefined> {
	for (const cmd of candidates) {
		if (await commandExists(cmd)) {
			return cmd;
		}
	}
	return undefined;
}

/**
 * Detect Mulch CLI availability, preferred command, `.mulch/` directory,
 * and installed version.
 *
 * This is the main entry point for detection. It combines CLI probing
 * with `.mulch/` directory checks into a single `MulchDetection` result.
 *
 * @param cwd       - Project directory to check for `.mulch/` and git root
 * @param command   - Override CLI command (from config). When provided,
 *                    this is probed first, falling back to default candidates.
 */
export async function detectMulch(
	cwd: string,
	command?: string,
): Promise<MulchDetection> {
	// Build candidate list: explicit command first, then defaults
	const candidates = command
		? [command, ...CLI_CANDIDATES.filter((c) => c !== command)]
		: [...CLI_CANDIDATES];

	const cliCommand = await resolveCliCommand(candidates);
	const cliAvailable = cliCommand !== undefined;
	const version = cliCommand ? await getVersion(cliCommand) : undefined;
	const mulchExists = await dotMulchDirExists(cwd);
	const cliPath = cliCommand ? await resolveCommandPath(cliCommand) : "";
	const repoRoot = await resolveGitRoot(cwd);
	const mulchDirPath = mulchExists ? join(repoRoot, ".mulch") : null;

	return {
		cliAvailable,
		cliCommand: cliCommand ?? "",
		cliPath,
		version: version ?? "",
		dotMulchExists: mulchExists,
		mulchDirExists: mulchExists,
		mulchDirPath,
		repoRoot,
	};
}

/**
 * Lightweight check: does the Mulch CLI appear to be installed?
 *
 * Useful for early returns where full detection isn't needed.
 */
export async function isMulchInstalled(
	command?: string,
): Promise<boolean> {
	const candidates = command
		? [command, ...CLI_CANDIDATES.filter((c) => c !== command)]
		: [...CLI_CANDIDATES];
	const cmd = await resolveCliCommand(candidates);
	return cmd !== undefined;
}

/**
 * Lightweight check: does `.mulch/` exist at `dir`?
 */
export async function hasDotMulch(dir: string): Promise<boolean> {
	return dotMulchDirExists(dir);
}
