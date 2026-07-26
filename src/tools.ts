import {
	getMulchStoreScopes,
	type MulchDetectionResult,
	type MulchStoreScope,
} from "./detect.js";
import {
	formatMulchResult,
	type RunMulchCommandDeps,
	runMulchCommand,
} from "./exec.js";
import type { ExtensionAPI } from "./pi-types.js";
import { createPrimeInjection } from "./prime.js";
import { Type } from "./schema.js";
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
				const injection = await createPrimeInjection(
					{
						detection,
						touchedFiles:
							params.files && params.files.length > 0
								? params.files.map((filePath) => filePath)
								: runtime.getTouchedFiles(),
						config: {
							...config,
							primeBudget: params.budget ?? config.primeBudget,
						},
						signal,
					},
					runner,
					deps,
				);
				if (!injection) {
					return errorToolResult("Mulch prime returned no usable context.");
				}
				return textToolResult(
					injection.content,
					config,
					params.fullOutput === true,
					{
						command: "mulch prime",
						exitCode: 0,
						success: true,
						signature: injection.signature,
					},
				);
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
				return scopedToolResult(
					detection,
					args,
					runtime.getConfig(),
					runner,
					deps,
					{
						json: true,
						fullOutput: params.fullOutput === true,
						signal,
					},
				);
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
				return scopedToolResult(
					detection,
					args,
					runtime.getConfig(),
					runner,
					deps,
					{
						json: true,
						fullOutput: params.fullOutput === true,
						signal,
					},
				);
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

				return scopedToolResult(
					detection,
					["learn"],
					runtime.getConfig(),
					runner,
					deps,
					{
						json: true,
						fullOutput: params.fullOutput === true,
						signal,
					},
				);
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

				if (!detection.directoryExists) {
					const result = await runner(
						{
							command: detection.cliCommand,
							args: ["--version"],
							cwd: detection.commandCwd,
							signal,
						},
						deps,
					);
					return toolResult(
						result,
						runtime.getConfig(),
						params.fullOutput === true,
					);
				}

				return scopedToolResult(
					detection,
					["status"],
					runtime.getConfig(),
					runner,
					deps,
					{
						json: true,
						fullOutput: params.fullOutput === true,
						signal,
					},
				);
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

interface ScopedToolOptions {
	json?: boolean;
	fullOutput?: boolean;
	signal?: AbortSignal;
}

async function scopedToolResult(
	detection: MulchDetectionResult,
	args: string[],
	config: MulchConfig,
	runner: typeof runMulchCommand,
	deps: RunMulchCommandDeps,
	options: ScopedToolOptions = {},
) {
	const scopes = getMulchStoreScopes(detection);
	const rendered: string[] = [];
	const details: Array<Record<string, unknown>> = [];
	const jsonResults: unknown[] = [];
	let success = false;

	for (const scope of scopes) {
		const result = await runner(
			{
				command: detection.cliCommand,
				args,
				cwd: scope.commandCwd,
				json: options.json,
				signal: options.signal,
			},
			deps,
		);
		if (result.ok) success = true;
		details.push(buildResultDetails(result, options.fullOutput === true));
		if (result.json !== undefined) jsonResults.push(result.json);
		rendered.push(renderScopedResult(scope, result));
	}

	if (rendered.length === 0) {
		return errorToolResult("Mulch is not ready in any memory scope.");
	}

	const json = jsonResults.length === 1 ? jsonResults[0] : undefined;
	return textToolResult(
		rendered.join("\n\n---\n\n"),
		config,
		options.fullOutput,
		{
			command: `${detection.cliCommand} ${args.join(" ")}`.trim(),
			success,
			scopes: details,
			json,
		},
	);
}

function renderScopedResult(
	scope: MulchStoreScope,
	result: Awaited<ReturnType<typeof runMulchCommand>>,
): string {
	const rawText = result.json
		? JSON.stringify(result.json, null, 2)
		: formatMulchResult(result);
	return scope.kind === "primary" ? rawText : `## ${scope.label}\n\n${rawText}`;
}

function textToolResult(
	rawText: string,
	config: MulchConfig,
	fullOutput = false,
	extraDetails: Record<string, unknown> = {},
) {
	const output = fullOutput
		? { text: rawText, truncated: false }
		: boundMulchOutput(rawText, config.outputMaxChars);

	return {
		content: [{ type: "text" as const, text: output.text }],
		details: {
			...extraDetails,
			outputTruncated: output.truncated,
			outputChars: rawText.length,
			outputMaxChars: fullOutput ? null : config.outputMaxChars,
			recovery: output.truncated
				? "Re-run the same Mulch tool with fullOutput=true for complete output."
				: undefined,
			json: output.truncated ? undefined : extraDetails.json,
		},
		isError: extraDetails.success === false,
	};
}

function buildResultDetails(
	result: Awaited<ReturnType<typeof runMulchCommand>>,
	fullOutput = false,
): Record<string, unknown> {
	const rawText = result.json
		? JSON.stringify(result.json, null, 2)
		: formatMulchResult(result);
	return {
		command: `${result.command} ${result.args.join(" ")}`.trim(),
		cwd: result.cwd,
		exitCode: result.exitCode,
		success: result.ok,
		outputChars: rawText.length,
		outputMaxChars: fullOutput ? null : undefined,
		json: result.json,
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
