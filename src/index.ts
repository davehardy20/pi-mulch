import * as path from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { DEFAULT_MULCH_CONFIG, loadMulchConfig } from "./config.js";
import {
	type DetectOptions,
	detectMulch,
	type MulchDetectionResult,
} from "./detect.js";
import {
	applyDraftFile,
	findLatestDraft,
	loadDraftFile,
	maybeWriteSessionDraft,
	saveDraftFile,
} from "./draft.js";
import { formatMulchResult, runMulchCommand } from "./exec.js";
import {
	extractPathsFromToolCall,
	extractPathsFromToolResult,
	extractPathsFromToolResultDetails,
} from "./paths.js";
import {
	buildPrimeRequest,
	createPrimeInjection,
	shouldInjectPrime,
} from "./prime.js";
import {
	createMulchSessionState,
	loadRepoInitState,
	resetMulchSessionState,
	saveRepoInitState,
	shouldOfferInitPrompt,
} from "./state.js";
import { registerMulchTools } from "./tools.js";
import type { MulchConfig } from "./types.js";

export interface MulchExtensionDeps {
	loadConfig?: (cwd: string) => MulchConfig;
	detectMulch?: (cwd: string, options: DetectOptions) => MulchDetectionResult;
	runMulchCommand?: typeof runMulchCommand;
}

export default function mulchIntegrationExtension(
	pi: ExtensionAPI,
	deps: MulchExtensionDeps = {},
): void {
	const loadConfig = deps.loadConfig ?? ((cwd: string) => loadMulchConfig(cwd));
	const detect =
		deps.detectMulch ??
		((cwd: string, options: DetectOptions) => detectMulch(cwd, options));
	const runMulch = deps.runMulchCommand ?? runMulchCommand;

	let config = DEFAULT_MULCH_CONFIG;
	const state = createMulchSessionState(config);

	function refreshConfig(cwd: string): MulchConfig {
		config = loadConfig(cwd);
		state.config = config;
		return config;
	}

	function refreshDetection(cwd: string): MulchDetectionResult {
		const detection = detect(cwd, {
			command: config.command,
			cliCandidates: config.cliCandidates,
		});
		state.detection = detection;
		return detection;
	}

	function getDetection(cwd: string): MulchDetectionResult | null {
		return state.detection ?? refreshDetection(cwd);
	}

	function setStatus(ctx: ExtensionContext): void {
		const detection = state.detection;
		if (!config.enabled) {
			ctx.ui.setStatus("mulch", "mulch: disabled");
			return;
		}
		if (!detection?.cliAvailable) {
			ctx.ui.setStatus("mulch", "mulch: cli missing");
			return;
		}
		if (!detection.directoryExists) {
			ctx.ui.setStatus("mulch", "mulch: init available");
			return;
		}
		ctx.ui.setStatus(
			"mulch",
			`mulch: ready (${state.touchedFiles.size} touched)`,
		);
	}

	function sendVisibleMessage(
		content: string,
		details?: Record<string, unknown>,
	): void {
		pi.sendMessage({
			customType: "mulch-output",
			content,
			details,
			display: true,
		});
	}

	async function maybeOfferInit(ctx: ExtensionContext): Promise<void> {
		const detection = state.detection;
		if (!detection?.gitRepoRoot) return;

		const repoInitState = loadRepoInitState(detection.gitRepoRoot, config);
		if (!shouldOfferInitPrompt(detection, config, state, repoInitState)) {
			return;
		}

		state.initPromptedRepos.add(detection.gitRepoRoot);
		if (!ctx.hasUI) return;

		const cli = detection.cliCommand ?? "mulch";
		const confirmed = await ctx.ui.confirm(
			"Initialize Mulch?",
			`No .mulch/ directory was found for this repo. Run \`${cli} init\` now?`,
		);

		if (!confirmed) {
			if (config.persistInitDecline) {
				saveRepoInitState(detection.gitRepoRoot, config, {
					suppressInitPrompt: true,
					declinedAt: new Date().toISOString(),
				});
			}
			ctx.ui.notify("Mulch init prompt suppressed for this repo.", "info");
			return;
		}

		const result = await runMulch({
			command: detection.cliCommand,
			args: ["init"],
			cwd: detection.commandCwd,
		});

		if (result.ok) {
			saveRepoInitState(detection.gitRepoRoot, config, {
				suppressInitPrompt: false,
				initializedAt: new Date().toISOString(),
			});
			refreshDetection(ctx.cwd);
			setStatus(ctx);
			ctx.ui.notify("Mulch initialized for this repository.", "info");
			return;
		}

		sendVisibleMessage(formatMulchResult(result));
		ctx.ui.notify("Mulch init failed.", "error");
	}

	async function runCommandAndRender(
		ctx: ExtensionCommandContext,
		args: string[],
		json = false,
	): Promise<void> {
		const detection = getDetection(ctx.cwd);
		if (!detection?.cliAvailable || !detection.cliCommand) {
			sendVisibleMessage("Mulch CLI is not available.");
			return;
		}

		const result = await runMulch({
			command: detection.cliCommand,
			args,
			cwd: detection.commandCwd,
			json,
		});

		const content = result.json
			? JSON.stringify(result.json, null, 2)
			: formatMulchResult(result);
		sendVisibleMessage(content, {
			command: `${result.command} ${result.args.join(" ")}`.trim(),
			exitCode: result.exitCode,
			success: result.ok,
		});
	}

	async function commandInit(ctx: ExtensionCommandContext): Promise<void> {
		const detection = getDetection(ctx.cwd);
		if (!detection?.cliAvailable || !detection.cliCommand) {
			sendVisibleMessage("Mulch CLI is not available.");
			return;
		}
		if (detection.directoryExists) {
			sendVisibleMessage(
				`Mulch is already initialized at ${detection.directoryPath}.`,
			);
			return;
		}
		if (!detection.gitRepoRoot) {
			sendVisibleMessage("Mulch init requires a Git repository.");
			return;
		}

		if (ctx.hasUI) {
			const confirmed = await ctx.ui.confirm(
				"Run mulch init?",
				`Initialize Mulch in ${detection.gitRepoRoot}?`,
			);
			if (!confirmed) return;
		}

		const result = await runMulch({
			command: detection.cliCommand,
			args: ["init"],
			cwd: detection.commandCwd,
		});
		sendVisibleMessage(formatMulchResult(result));
		if (result.ok) {
			refreshDetection(ctx.cwd);
			setStatus(ctx);
		}
	}

	async function commandReview(
		ctx: ExtensionCommandContext,
		args: string,
	): Promise<void> {
		const detection = getDetection(ctx.cwd);
		if (!detection?.gitRepoRoot) {
			sendVisibleMessage("Mulch review requires a Git-backed project.");
			return;
		}

		const draftPath =
			args.trim() ||
			findLatestDraft(path.dirname(detection.directoryPath), config) ||
			"";
		if (!draftPath) {
			sendVisibleMessage("No Mulch draft was found.");
			return;
		}

		const draft = loadDraftFile(draftPath);
		const current = JSON.stringify(draft, null, 2);
		if (!ctx.hasUI) {
			sendVisibleMessage(current, { draftPath });
			return;
		}

		const edited = await ctx.ui.editor("Review Mulch draft", current);
		if (edited === undefined) {
			ctx.ui.notify("Mulch draft review cancelled.", "info");
			return;
		}

		const parsed = JSON.parse(edited) as typeof draft;
		saveDraftFile(draftPath, parsed);
		sendVisibleMessage(`Saved Mulch draft: ${draftPath}`);
	}

	async function commandApply(
		ctx: ExtensionCommandContext,
		args: string,
	): Promise<void> {
		if (!ctx.hasUI) {
			sendVisibleMessage(
				"/mulch-apply requires an interactive UI for review and confirmation.",
			);
			return;
		}

		const detection = getDetection(ctx.cwd);
		if (!detection?.ready || !detection.cliCommand || !detection.gitRepoRoot) {
			sendVisibleMessage("Mulch is not ready in this repository.");
			return;
		}

		const draftPath =
			args.trim() ||
			findLatestDraft(path.dirname(detection.directoryPath), config) ||
			"";
		if (!draftPath) {
			sendVisibleMessage("No Mulch draft was found.");
			return;
		}

		const current = JSON.stringify(loadDraftFile(draftPath), null, 2);
		const edited = await ctx.ui.editor(
			"Review Mulch draft before apply",
			current,
		);
		if (edited === undefined) {
			ctx.ui.notify("Mulch apply cancelled.", "info");
			return;
		}

		const parsed = JSON.parse(edited) as ReturnType<typeof loadDraftFile>;
		saveDraftFile(draftPath, parsed);

		const actionableCount = parsed.records.filter(
			(record) => !record.placeholder,
		).length;
		const confirmed = await ctx.ui.confirm(
			"Apply Mulch draft?",
			`Apply ${actionableCount} non-placeholder record(s) from ${draftPath}?`,
		);
		if (!confirmed) {
			return;
		}

		const applied = await applyDraftFile(
			draftPath,
			{
				command: detection.cliCommand,
				cwd: detection.commandCwd,
			},
			runMulch,
		);

		const failures = applied.results.filter((result) => !result.ok);
		if (failures.length > 0) {
			sendVisibleMessage(
				failures.map((result) => formatMulchResult(result)).join("\n\n"),
			);
			return;
		}

		sendVisibleMessage(
			`Applied Mulch draft: ${draftPath}\n` +
				`${applied.draft.applyResults?.map((entry) => `${entry.domain}: ${entry.appliedCount}`).join("\n") ?? "No actionable records."}`,
		);
	}

	pi.on("session_start", async (event, ctx) => {
		if (event.reason === "reload") {
			// On reload, keep existing state and just re-detect
			refreshConfig(ctx.cwd);
			refreshDetection(ctx.cwd);
			setStatus(ctx);
			return;
		}

		// For startup/new/resume/fork: full state reset + re-init
		const preservedInitRepos = new Set(state.initPromptedRepos);
		resetMulchSessionState(state, refreshConfig(ctx.cwd));
		state.initPromptedRepos = preservedInitRepos;
		refreshDetection(ctx.cwd);
		setStatus(ctx);
		await maybeOfferInit(ctx);
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!config.enabled) return;
		state.touchedFiles.addAll(extractPathsFromToolCall(event), ctx.cwd);
		setStatus(ctx);
	});

	pi.on("tool_result", async (event, ctx) => {
		if (!config.enabled) return;
		state.touchedFiles.addAll(extractPathsFromToolResult(event), ctx.cwd);
		state.touchedFiles.addAll(
			extractPathsFromToolResultDetails(event.details),
			ctx.cwd,
		);
		setStatus(ctx);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		state.lastUserPrompt = event.prompt;
		if (!config.enabled) return;

		const detection = getDetection(ctx.cwd);
		if (!detection?.ready) {
			return;
		}

		const injection = await createPrimeInjection(
			{
				detection,
				touchedFiles: state.touchedFiles.getAll(),
				config,
				signal: ctx.signal,
			},
			runMulch,
		);

		if (!injection) return;
		if (
			!shouldInjectPrime(
				state.lastPrimeSignature,
				state.lastPrimeContent,
				injection,
			)
		) {
			return;
		}

		state.lastPrimeSignature = injection.signature;
		state.lastPrimeContent = injection.content;

		return {
			message: {
				customType: "mulch-prime",
				content: injection.content,
				display: false,
				details: {
					mode: injection.mode,
					signature: injection.signature,
				},
			},
		};
	});

	pi.on("session_shutdown", async (event, ctx) => {
		if (!config.enabled) {
			ctx.ui.setStatus("mulch", "");
			return;
		}

		// Generate draft on quit or session replacement
		if (event.reason !== "reload") {
			const draftPath = await maybeWriteSessionDraft(
				{
					detection: state.detection,
					config,
					sessionManager: ctx.sessionManager,
					touchedFiles: state.touchedFiles.getAll(),
					lastUserPrompt: state.lastUserPrompt,
					signal: ctx.signal,
				},
				runMulch,
			);

			if (draftPath) {
				state.latestDraftPath = draftPath;
				ctx.ui.notify(`Mulch draft created: ${draftPath}`, "info");
			}
		}

		// On reload, keep state — session_start will refresh detection
		// On quit/new/resume/fork, clear status but preserve init suppression
		ctx.ui.setStatus("mulch", "");
	});

	registerMulchTools(
		pi,
		{
			getConfig: () => config,
			getDetection,
			getTouchedFiles: () => state.touchedFiles.getAll(),
		},
		runMulch,
	);

	pi.registerCommand("mulch-init", {
		description: "Initialize Mulch in the current repository.",
		handler: async (_args, ctx) => {
			await commandInit(ctx);
		},
	});

	pi.registerCommand("mulch-prime", {
		description: "Prime Mulch context for this repository.",
		handler: async (_args, ctx) => {
			const detection = getDetection(ctx.cwd);
			if (!detection?.ready || !detection.cliCommand) {
				sendVisibleMessage("Mulch is not ready in this repository.");
				return;
			}
			const request = buildPrimeRequest(
				detection,
				state.touchedFiles.getAll(),
				config,
			);
			await runCommandAndRender(ctx, request.args, false);
		},
	});

	pi.registerCommand("mulch-search", {
		description: "Search Mulch records.",
		handler: async (args, ctx) => {
			const query = args.trim();
			if (!query) {
				sendVisibleMessage("Usage: /mulch-search <query>");
				return;
			}
			await runCommandAndRender(ctx, ["search", query], true);
		},
	});

	pi.registerCommand("mulch-query", {
		description: "Query Mulch records for one domain or all domains.",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			await runCommandAndRender(
				ctx,
				trimmed ? ["query", trimmed] : ["query", "--all"],
				true,
			);
		},
	});

	pi.registerCommand("mulch-learn", {
		description: "Show Mulch learn suggestions for current changes.",
		handler: async (_args, ctx) => {
			await runCommandAndRender(ctx, ["learn"], true);
		},
	});

	pi.registerCommand("mulch-status", {
		description: "Show Mulch repository status.",
		handler: async (_args, ctx) => {
			const detection = getDetection(ctx.cwd);
			if (!detection?.cliAvailable) {
				sendVisibleMessage("Mulch CLI is not available.");
				return;
			}
			if (!detection.directoryExists) {
				sendVisibleMessage(JSON.stringify(detection, null, 2));
				return;
			}
			await runCommandAndRender(ctx, ["status"], true);
		},
	});

	pi.registerCommand("mulch-review", {
		description: "Review the latest Mulch draft file.",
		handler: async (args, ctx) => {
			await commandReview(ctx, args);
		},
	});

	pi.registerCommand("mulch-apply", {
		description: "Review and apply the latest Mulch draft file.",
		handler: async (args, ctx) => {
			await commandApply(ctx, args);
		},
	});

	// --- User-command-only commands (NOT LLM-callable) ---
	// These are destructive/mutating operations that require explicit user invocation.

	pi.registerCommand("mulch-sync", {
		description: "Validate, stage, and commit .mulch/ changes.",
		handler: async (args, ctx) => {
			const detection = getDetection(ctx.cwd);
			if (!detection?.ready || !detection.cliCommand) {
				sendVisibleMessage("Mulch is not ready in this repository.");
				return;
			}
			const cliArgs = ["sync"];
			if (args.trim()) cliArgs.push(...splitCliArgs(args));
			await runCommandAndRender(ctx, cliArgs, false);
		},
	});

	pi.registerCommand("mulch-prune", {
		description: "Soft-archive or hard-delete stale Mulch records.",
		handler: async (args, ctx) => {
			const detection = getDetection(ctx.cwd);
			if (!detection?.ready || !detection.cliCommand) {
				sendVisibleMessage("Mulch is not ready in this repository.");
				return;
			}
			const cliArgs = ["prune"];
			if (args.trim()) cliArgs.push(...splitCliArgs(args));
			await runCommandAndRender(ctx, cliArgs, false);
		},
	});

	pi.registerCommand("mulch-delete", {
		description: "Delete a Mulch expertise record.",
		handler: async (args, ctx) => {
			const detection = getDetection(ctx.cwd);
			if (!detection?.ready || !detection.cliCommand) {
				sendVisibleMessage("Mulch is not ready in this repository.");
				return;
			}
			const trimmed = args.trim();
			if (!trimmed) {
				sendVisibleMessage("Usage: /mulch-delete <domain> [id]");
				return;
			}
			if (ctx.hasUI) {
				const confirmed = await ctx.ui.confirm(
					"Delete Mulch record?",
					`Run mulch delete ${trimmed}? This is destructive.`,
				);
				if (!confirmed) return;
			}
			await runCommandAndRender(
				ctx,
				["delete", ...splitCliArgs(trimmed)],
				false,
			);
		},
	});

	pi.registerCommand("mulch-delete-domain", {
		description: "Delete a Mulch domain and its expertise file.",
		handler: async (args, ctx) => {
			const detection = getDetection(ctx.cwd);
			if (!detection?.ready || !detection.cliCommand) {
				sendVisibleMessage("Mulch is not ready in this repository.");
				return;
			}
			const domain = args.trim();
			if (!domain) {
				sendVisibleMessage("Usage: /mulch-delete-domain <domain>");
				return;
			}
			if (ctx.hasUI) {
				const confirmed = await ctx.ui.confirm(
					"Delete entire Mulch domain?",
					"Run mulch delete-domain " +
						domain +
						"? This will remove the domain and all its records.",
				);
				if (!confirmed) return;
			}
			await runCommandAndRender(ctx, ["delete-domain", domain], false);
		},
	});
}

/**
 * Minimal shell-like argument splitter for command arguments.
 * Handles simple space-separated tokens; does not support quoting.
 */
function splitCliArgs(input: string): string[] {
	return input.split(/\s+/).filter((token) => token.length > 0);
}
