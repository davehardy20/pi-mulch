import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_MULCH_CONFIG } from "./config.js";
import type { MulchDetectionResult } from "./detect.js";
import { createTouchedFileTracker, type TouchedFileTracker } from "./paths.js";
import type { MulchConfig, RepoInitState } from "./types.js";

export interface MulchSessionState {
	config: MulchConfig;
	detection: MulchDetectionResult | null;
	touchedFiles: TouchedFileTracker;
	initPromptedRepos: Set<string>;
	lastPrimeSignature: string | null;
	lastPrimeContent: string | null;
	lastUserPrompt: string;
	latestDraftPath: string | null;
}

export interface RepoStateDeps {
	existsSync?: typeof fs.existsSync;
	readFileSync?: typeof fs.readFileSync;
	writeFileSync?: typeof fs.writeFileSync;
	mkdirSync?: typeof fs.mkdirSync;
}

export function createMulchSessionState(
	config: MulchConfig = DEFAULT_MULCH_CONFIG,
): MulchSessionState {
	return {
		config,
		detection: null,
		touchedFiles: createTouchedFileTracker(),
		initPromptedRepos: new Set<string>(),
		lastPrimeSignature: null,
		lastPrimeContent: null,
		lastUserPrompt: "",
		latestDraftPath: null,
	};
}

export function resetMulchSessionState(
	state: MulchSessionState,
	config: MulchConfig,
): void {
	state.config = config;
	state.detection = null;
	state.touchedFiles.clear();
	state.initPromptedRepos.clear();
	state.lastPrimeSignature = null;
	state.lastPrimeContent = null;
	state.lastUserPrompt = "";
	state.latestDraftPath = null;
}

export function getRepoInitStatePath(
	repoRoot: string,
	config: MulchConfig,
): string {
	return path.resolve(repoRoot, config.initStateFile);
}

export function loadRepoInitState(
	repoRoot: string,
	config: MulchConfig,
	deps: RepoStateDeps = {},
): RepoInitState {
	const existsSync = deps.existsSync ?? fs.existsSync;
	const readFileSync = deps.readFileSync ?? fs.readFileSync;
	const filePath = getRepoInitStatePath(repoRoot, config);

	if (!existsSync(filePath)) {
		return {};
	}

	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8")) as RepoInitState;
		return typeof parsed === "object" && parsed !== null ? parsed : {};
	} catch {
		return {};
	}
}

export function saveRepoInitState(
	repoRoot: string,
	config: MulchConfig,
	state: RepoInitState,
	deps: RepoStateDeps = {},
): string {
	const writeFileSync = deps.writeFileSync ?? fs.writeFileSync;
	const mkdirSync = deps.mkdirSync ?? fs.mkdirSync;
	const filePath = getRepoInitStatePath(repoRoot, config);

	mkdirSync(path.dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
	return filePath;
}

export function shouldOfferInitPrompt(
	detection: MulchDetectionResult | null,
	config: MulchConfig,
	state: MulchSessionState,
	repoInitState: RepoInitState,
): boolean {
	if (!config.enabled) return false;
	if (!config.promptOnMissingInit) return false;
	if (!detection?.cliAvailable) return false;
	if (detection.directoryExists) return false;
	if (!detection.isGitRepo || !detection.gitRepoRoot) return false;
	if (repoInitState.suppressInitPrompt) return false;
	if (state.initPromptedRepos.has(detection.gitRepoRoot)) return false;
	return true;
}
