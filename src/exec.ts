import * as childProcess from "node:child_process";
import type { MulchCommandResult } from "./types.js";

export interface RunMulchCommandOptions {
	command: string | null;
	args: string[];
	cwd: string;
	json?: boolean;
	signal?: AbortSignal;
}

export interface RunMulchCommandDeps {
	execFile?: typeof childProcess.execFile;
}

export async function runMulchCommand(
	options: RunMulchCommandOptions,
	deps: RunMulchCommandDeps = {},
): Promise<MulchCommandResult> {
	if (!options.command) {
		return {
			command: "",
			args: options.args,
			cwd: options.cwd,
			exitCode: 1,
			stdout: "",
			stderr: "Mulch CLI is not configured or available.",
			ok: false,
		};
	}

	const execFile = deps.execFile ?? childProcess.execFile;
	const args = options.json ? ["--json", ...options.args] : [...options.args];

	return await new Promise((resolve) => {
		execFile(
			options.command as string,
			args,
			{
				cwd: options.cwd,
				encoding: "utf8",
				maxBuffer: 2_000_000,
				signal: options.signal,
			},
			(error, stdout, stderr) => {
				const exitCode =
					typeof error?.code === "number" ? error.code : error ? 1 : 0;

				const result: MulchCommandResult = {
					command: options.command as string,
					args,
					cwd: options.cwd,
					exitCode,
					stdout: stdout ?? "",
					stderr: stderr ?? "",
					ok: exitCode === 0,
				};

				if (options.json && result.ok && result.stdout.trim().length > 0) {
					try {
						result.json = JSON.parse(result.stdout);
					} catch {
						// leave json undefined; callers can still inspect stdout
					}
				}

				resolve(result);
			},
		);
	});
}

export function formatMulchResult(result: MulchCommandResult): string {
	const command = `${result.command} ${result.args.join(" ")}`.trim();
	const sections = [`Command: ${command}`, `Exit code: ${result.exitCode}`];

	if (result.stdout.trim().length > 0) {
		sections.push("", result.stdout.trim());
	}
	if (result.stderr.trim().length > 0) {
		sections.push("", `stderr:\n${result.stderr.trim()}`);
	}

	return sections.join("\n");
}
