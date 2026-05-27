import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { MulchDetectionResult } from "./detect.js";
import {
	formatMulchResult,
	type RunMulchCommandDeps,
	runMulchCommand,
} from "./exec.js";
import { buildPrimeRequest } from "./prime.js";
import type { MulchConfig } from "./types.js";

const FULL_OUTPUT_DESCRIPTION =
	"Return the full raw Mulch output instead of the default bounded summary.";

export interface ToolRuntime {
	getConfig(): MulchConfig;
	getDetection(cwd: string): MulchDetectionResult | null;
	getTouchedFiles(): string[];
}

export function registerMulchTools(
	pi: ExtensionAPI,
	runtime: ToolRuntime,
	runner: typeof runMulchCommand = runMulchCommand,
	deps: RunMulchCommandDeps = {},
): void {
	const enabled = new Set(runtime.getConfig().llmTools);

	if (enabled.has("mulch_prime")) {
		pi.registerTool({
			name: "mulch_prime",
			label: "Mulch Prime",
			description:
				"Prime Mulch context using manifest mode or file-scoped records.",
			promptSnippet:
				"Use mulch_prime to load Mulch context before deeper repository reasoning.",
			promptGuidelines: [
				"Use mulch_prime when the task benefits from project-specific expertise already stored in Mulch.",
			],
			parameters: Type.Object({
				files: Type.Optional(Type.Array(Type.String())),
				budget: Type.Optional(Type.Number({ minimum: 1 })),
				fullOutput: Type.Optional(
					Type.Boolean({ description: FULL_OUTPUT_DESCRIPTION }),
				),
			}),
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const detection = runtime.getDetection(ctx.cwd);
				if (!detection?.ready || !detection.cliCommand) {
					return errorToolResult("Mulch is not ready in this repository.");
				}

				const config = runtime.getConfig();
				const request = buildPrimeRequest(
					detection,
					params.files && params.files.length > 0
						? params.files.map((filePath) => filePath)
						: runtime.getTouchedFiles(),
					{
						...config,
						primeBudget: params.budget ?? config.primeBudget,
					},
				);
				const result = await runner(
					{
						command: detection.cliCommand,
						args: request.args,
						cwd: detection.commandCwd,
						signal,
					},
					deps,
				);
				return toolResult(result, config, params.fullOutput === true);
			},
		});
	}

	if (enabled.has("mulch_search")) {
		pi.registerTool({
			name: "mulch_search",
			label: "Mulch Search",
			description: "Search Mulch expertise across domains.",
			promptSnippet:
				"Use mulch_search to find relevant Mulch records by query.",
			parameters: Type.Object({
				query: Type.String({ minLength: 1 }),
				domain: Type.Optional(Type.String()),
				file: Type.Optional(Type.String()),
				type: Type.Optional(Type.String()),
				fullOutput: Type.Optional(
					Type.Boolean({ description: FULL_OUTPUT_DESCRIPTION }),
				),
			}),
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const detection = runtime.getDetection(ctx.cwd);
				if (!detection?.ready || !detection.cliCommand) {
					return errorToolResult("Mulch is not ready in this repository.");
				}

				const args = ["search", params.query];
				if (params.domain) args.push("--domain", params.domain);
				if (params.file) args.push("--file", params.file);
				if (params.type) args.push("--type", params.type);
				const result = await runner(
					{
						command: detection.cliCommand,
						args,
						cwd: detection.commandCwd,
						json: true,
						signal,
					},
					deps,
				);
				return toolResult(result, runtime.getConfig(), params.fullOutput === true);
			},
		});
	}

	if (enabled.has("mulch_query")) {
		pi.registerTool({
			name: "mulch_query",
			label: "Mulch Query",
			description: "Query Mulch records for one domain or all domains.",
			promptSnippet:
				"Use mulch_query to inspect records directly when you already know the target domain.",
			parameters: Type.Object({
				domain: Type.Optional(Type.String()),
				file: Type.Optional(Type.String()),
				type: Type.Optional(Type.String()),
				all: Type.Optional(Type.Boolean()),
				fullOutput: Type.Optional(
					Type.Boolean({ description: FULL_OUTPUT_DESCRIPTION }),
				),
			}),
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const detection = runtime.getDetection(ctx.cwd);
				if (!detection?.ready || !detection.cliCommand) {
					return errorToolResult("Mulch is not ready in this repository.");
				}

				const args = ["query"];
				if (params.domain) args.push(params.domain);
				if (params.file) args.push("--file", params.file);
				if (params.type) args.push("--type", params.type);
				if (params.all) args.push("--all");
				const result = await runner(
					{
						command: detection.cliCommand,
						args,
						cwd: detection.commandCwd,
						json: true,
						signal,
					},
					deps,
				);
				return toolResult(result, runtime.getConfig(), params.fullOutput === true);
			},
		});
	}

	if (enabled.has("mulch_learn")) {
		pi.registerTool({
			name: "mulch_learn",
			label: "Mulch Learn",
			description:
				"Show changed files and Mulch domain suggestions for learnings.",
			promptSnippet:
				"Use mulch_learn to inspect what Mulch thinks is worth recording from current changes.",
			parameters: Type.Object({
				fullOutput: Type.Optional(
					Type.Boolean({ description: FULL_OUTPUT_DESCRIPTION }),
				),
			}),
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const detection = runtime.getDetection(ctx.cwd);
				if (!detection?.ready || !detection.cliCommand) {
					return errorToolResult("Mulch is not ready in this repository.");
				}

				const result = await runner(
					{
						command: detection.cliCommand,
						args: ["learn"],
						cwd: detection.commandCwd,
						json: true,
						signal,
					},
					deps,
				);
				return toolResult(result, runtime.getConfig(), params.fullOutput === true);
			},
		});
	}

	if (enabled.has("mulch_status")) {
		pi.registerTool({
			name: "mulch_status",
			label: "Mulch Status",
			description: "Show current Mulch domain and governance status.",
			promptSnippet:
				"Use mulch_status to inspect Mulch repository readiness and domain counts.",
			parameters: Type.Object({
				fullOutput: Type.Optional(
					Type.Boolean({ description: FULL_OUTPUT_DESCRIPTION }),
				),
			}),
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const detection = runtime.getDetection(ctx.cwd);
				if (!detection?.cliAvailable || !detection.cliCommand) {
					return errorToolResult("Mulch CLI is not available.");
				}

				const result = await runner(
					{
						command: detection.cliCommand,
						args: detection.directoryExists ? ["status"] : ["--version"],
						cwd: detection.commandCwd,
						json: detection.directoryExists,
						signal,
					},
					deps,
				);
				return toolResult(result, runtime.getConfig(), params.fullOutput === true);
			},
		});
	}
}

function errorToolResult(message: string) {
	return {
		content: [{ type: "text" as const, text: message }],
		details: { success: false },
		isError: true,
	};
}

function toolResult(
	result: Awaited<ReturnType<typeof runMulchCommand>>,
	config: MulchConfig,
	fullOutput = false,
) {
	const rawText = result.json
		? JSON.stringify(result.json, null, 2)
		: formatMulchResult(result);
	const output = fullOutput
		? { text: rawText, truncated: false }
		: boundMulchOutput(rawText, config.outputMaxChars);
	const command = `${result.command} ${result.args.join(" ")}`.trim();

	return {
		content: [{ type: "text" as const, text: output.text }],
		details: {
			command,
			exitCode: result.exitCode,
			success: result.ok,
			outputTruncated: output.truncated,
			outputChars: rawText.length,
			outputMaxChars: fullOutput ? null : config.outputMaxChars,
			recovery: output.truncated
				? `Re-run the same Mulch tool with fullOutput=true, or run: ${command}`
				: undefined,
			json: output.truncated ? undefined : result.json,
		},
		isError: !result.ok,
	};
}

function boundMulchOutput(text: string, maxChars: number) {
	if (text.length <= maxChars) {
		return { text, truncated: false };
	}

	const marker = `\n\n… Mulch output truncated from ${text.length} to ${maxChars} chars. Re-run with fullOutput=true for the complete output. …\n\n`;
	if (marker.length >= maxChars) {
		return {
			text: marker.slice(0, maxChars),
			truncated: true,
		};
	}

	const available = maxChars - marker.length;
	const headChars = Math.ceil(available * 0.65);
	const tailChars = Math.floor(available * 0.35);

	return {
		text: `${text.slice(0, headChars)}${marker}${text.slice(text.length - tailChars)}`,
		truncated: true,
	};
}
