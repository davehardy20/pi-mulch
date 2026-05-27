export type MulchInjectionMode = "manifest";
export type MulchDraftMode = "off" | "session-end";
export type MulchLinterStatus = "unknown" | "clean" | "findings" | "error";
export type MulchRecordType =
	| "convention"
	| "pattern"
	| "failure"
	| "decision"
	| "reference"
	| "guide";
export type MulchClassification = "foundational" | "tactical" | "observational";
export type MulchCallableToolName =
	| "mulch_prime"
	| "mulch_search"
	| "mulch_query"
	| "mulch_learn"
	| "mulch_status";

export interface MulchConfig {
	enabled: boolean;
	command: string | null;
	cliCandidates: string[];
	injectionMode: MulchInjectionMode;
	primeBudget: number;
	outputMaxChars: number;
	promptOnMissingInit: boolean;
	persistInitDecline: boolean;
	draftMode: MulchDraftMode;
	draftDir: string;
	initStateFile: string;
	maxTrackedFiles: number;
	llmTools: MulchCallableToolName[];
}

export interface MulchPrimeRequest {
	mode: "manifest" | "files";
	args: string[];
	signature: string;
	scopedFiles: string[];
}

export interface MulchPrimeInjection {
	mode: "manifest" | "files";
	signature: string;
	content: string;
}

export interface MulchDraftRecord {
	domain: string;
	type: MulchRecordType;
	classification?: MulchClassification;
	name?: string;
	title?: string;
	description?: string;
	rationale?: string;
	resolution?: string;
	content?: string;
	files?: string[];
	tags?: string[];
	placeholder?: boolean;
}

export interface MulchDraftFile {
	version: 1;
	createdAt: string;
	repoRoot: string;
	linterStatus: MulchLinterStatus;
	lastUserPrompt: string;
	touchedFiles: string[];
	learn: unknown;
	records: MulchDraftRecord[];
	appliedAt?: string;
	applyResults?: Array<{
		domain: string;
		appliedCount: number;
	}>;
}

export interface RepoInitState {
	suppressInitPrompt?: boolean;
	declinedAt?: string;
	initializedAt?: string;
}

export interface MulchCommandResult {
	command: string;
	args: string[];
	cwd: string;
	exitCode: number;
	stdout: string;
	stderr: string;
	ok: boolean;
	json?: unknown;
}
