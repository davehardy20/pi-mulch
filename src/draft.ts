import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { MulchDetectionResult } from "./detect.js";
import { type RunMulchCommandDeps, runMulchCommand } from "./exec.js";
import { toRepoRelativePath } from "./path-utils.js";
import type {
	MulchCommandResult,
	MulchConfig,
	MulchDraftFile,
	MulchDraftRecord,
	MulchLinterStatus,
	MulchRecordType,
} from "./types.js";

export interface DraftFsDeps {
	existsSync?: typeof fs.existsSync;
	mkdirSync?: typeof fs.mkdirSync;
	readdirSync?: typeof fs.readdirSync;
	readFileSync?: typeof fs.readFileSync;
	statSync?: typeof fs.statSync;
	writeFileSync?: typeof fs.writeFileSync;
	unlinkSync?: typeof fs.unlinkSync;
	tmpdir?: typeof os.tmpdir;
}

export function getLatestLinterStatus(
	entries: readonly SessionEntry[],
): MulchLinterStatus {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (!entry) continue;

		if (
			entry.type === "custom_message" &&
			entry.customType === "post-turn-linter-status"
		) {
			const status = asRecord(entry.details)?.status;
			if (status === "clean") return "clean";
			if (status === "error") return "error";
			const text = typeof entry.content === "string" ? entry.content : "";
			if (text.includes("clean")) return "clean";
			if (text.includes("error")) return "error";
			return "findings";
		}

		if (
			entry.type === "custom_message" &&
			entry.customType === "post-turn-linter"
		) {
			return "findings";
		}
	}

	return "unknown";
}

export function buildDraftFile(params: {
	repoRoot: string;
	linterStatus: MulchLinterStatus;
	touchedFiles: readonly string[];
	lastUserPrompt: string;
	learn: unknown;
}): MulchDraftFile {
	const learnRecord = asRecord(params.learn);
	const suggestedDomains = Array.isArray(learnRecord?.suggestedDomains)
		? learnRecord.suggestedDomains.filter(
				(entry): entry is string =>
					typeof entry === "string" && entry.trim().length > 0,
			)
		: [];

	const relativeFiles = params.touchedFiles
		.map((filePath) => toRepoRelativePath(filePath, params.repoRoot))
		.filter((filePath) => filePath !== ".");

	const records = buildPlaceholderRecords(suggestedDomains, relativeFiles);

	return {
		version: 1,
		createdAt: new Date().toISOString(),
		repoRoot: params.repoRoot,
		linterStatus: params.linterStatus,
		lastUserPrompt: params.lastUserPrompt,
		touchedFiles: relativeFiles,
		learn: params.learn,
		records,
	};
}

export function writeDraftFile(
	repoRoot: string,
	config: MulchConfig,
	draft: MulchDraftFile,
	deps: DraftFsDeps = {},
): string {
	const mkdirSync = deps.mkdirSync ?? fs.mkdirSync;
	const writeFileSync = deps.writeFileSync ?? fs.writeFileSync;
	const draftDir = path.resolve(repoRoot, config.draftDir);
	mkdirSync(draftDir, { recursive: true });

	const stamp = draft.createdAt.replace(/[.:]/g, "-");
	const filePath = path.join(draftDir, `pi-mulch-draft-${stamp}.json`);
	writeFileSync(filePath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
	return filePath;
}

export function findLatestDraft(
	repoRoot: string,
	config: MulchConfig,
	deps: DraftFsDeps = {},
): string | null {
	const existsSync = deps.existsSync ?? fs.existsSync;
	const readdirSync = deps.readdirSync ?? fs.readdirSync;
	const statSync = deps.statSync ?? fs.statSync;
	const draftDir = path.resolve(repoRoot, config.draftDir);
	if (!existsSync(draftDir)) {
		return null;
	}

	const candidates = readdirSync(draftDir)
		.filter((entry) => entry.endsWith(".json"))
		.map((entry) => path.join(draftDir, entry))
		.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);

	return candidates[0] ?? null;
}

export function loadDraftFile(
	filePath: string,
	deps: DraftFsDeps = {},
): MulchDraftFile {
	const readFileSync = deps.readFileSync ?? fs.readFileSync;
	return JSON.parse(readFileSync(filePath, "utf8")) as MulchDraftFile;
}

export function saveDraftFile(
	filePath: string,
	draft: MulchDraftFile,
	deps: DraftFsDeps = {},
): void {
	const writeFileSync = deps.writeFileSync ?? fs.writeFileSync;
	writeFileSync(filePath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
}

export function getActionableDraftRecords(
	draft: MulchDraftFile,
): MulchDraftRecord[] {
	return draft.records.filter((record) => toBatchRecord(record) !== null);
}

export async function maybeWriteSessionDraft(
	params: {
		detection: MulchDetectionResult | null;
		config: MulchConfig;
		sessionManager: { getEntries(): SessionEntry[] };
		touchedFiles: readonly string[];
		lastUserPrompt: string;
		signal?: AbortSignal;
	},
	runner: typeof runMulchCommand = runMulchCommand,
	deps: RunMulchCommandDeps & DraftFsDeps = {},
): Promise<string | null> {
	if (params.config.draftMode !== "session-end") return null;
	if (!params.detection?.ready || !params.detection.cliCommand) return null;
	if (!params.detection.gitRepoRoot) return null;
	if (params.touchedFiles.length === 0) return null;

	const linterStatus = getLatestLinterStatus(
		params.sessionManager.getEntries(),
	);
	if (linterStatus !== "clean") {
		return null;
	}

	const repoRoot = params.detection.gitRepoRoot;
	const mulchRoot = params.detection.commandCwd;
	const repoFiles = params.touchedFiles.filter(
		(filePath) =>
			filePath === repoRoot || filePath.startsWith(`${repoRoot}${path.sep}`),
	);
	if (repoFiles.length === 0) {
		return null;
	}

	const learnResult = await runner(
		{
			command: params.detection.cliCommand,
			args: ["learn"],
			cwd: mulchRoot,
			json: true,
			signal: params.signal,
		},
		deps,
	);
	if (!learnResult.ok) {
		return null;
	}

	const draft = buildDraftFile({
		repoRoot,
		linterStatus,
		touchedFiles: repoFiles,
		lastUserPrompt: params.lastUserPrompt,
		learn: learnResult.json ?? learnResult.stdout,
	});

	return writeDraftFile(mulchRoot, params.config, draft, deps);
}

export async function applyDraftFile(
	filePath: string,
	params: {
		command: string | null;
		cwd: string;
	},
	runner: typeof runMulchCommand = runMulchCommand,
	deps: RunMulchCommandDeps & DraftFsDeps = {},
): Promise<{
	draft: MulchDraftFile;
	results: MulchCommandResult[];
}> {
	const tmpdir = deps.tmpdir ?? os.tmpdir;
	const writeFileSync = deps.writeFileSync ?? fs.writeFileSync;
	const unlinkSync = deps.unlinkSync ?? fs.unlinkSync;

	const draft = loadDraftFile(filePath, deps);
	const grouped = new Map<string, Array<Record<string, unknown>>>();
	for (const record of draft.records) {
		const normalized = toBatchRecord(record);
		if (normalized === null) continue;
		const batch = grouped.get(record.domain) ?? [];
		batch.push(normalized);
		grouped.set(record.domain, batch);
	}

	const results: MulchCommandResult[] = [];
	const applyResults: Array<{ domain: string; appliedCount: number }> = [];
	for (const [domain, batch] of grouped) {
		const tempFile = path.join(
			tmpdir(),
			`pi-mulch-apply-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
		);
		writeFileSync(tempFile, `${JSON.stringify(batch, null, 2)}\n`, "utf8");
		try {
			const result = await runner(
				{
					command: params.command,
					args: ["record", domain, "--batch", tempFile],
					cwd: params.cwd,
					json: true,
				},
				deps,
			);
			results.push(result);
			if (result.ok) {
				applyResults.push({ domain, appliedCount: batch.length });
			}
		} finally {
			try {
				unlinkSync(tempFile);
			} catch {
				// ignore best-effort cleanup failures
			}
		}
	}

	draft.appliedAt = new Date().toISOString();
	draft.applyResults = applyResults;
	saveDraftFile(filePath, draft, deps);

	return { draft, results };
}

function buildPlaceholderRecords(
	suggestedDomains: readonly string[],
	touchedFiles: readonly string[],
): MulchDraftRecord[] {
	return suggestedDomains.map((domain) => ({
		domain,
		type: "guide",
		classification: "tactical",
		name: `TODO: summarize learning for ${domain}`,
		description: `TODO: replace this placeholder with a useful Mulch record for ${domain}.`,
		files: [...touchedFiles],
		tags: ["draft", "pi-mulch"],
		placeholder: true,
	}));
}

function toBatchRecord(
	record: MulchDraftRecord,
): Record<string, unknown> | null {
	if (record.placeholder) return null;
	if (typeof record.domain !== "string" || record.domain.trim().length === 0) {
		return null;
	}

	const type = normalizeType(record.type);
	if (!type) return null;

	switch (type) {
		case "convention": {
			const content = record.content ?? record.description;
			if (!content) return null;
			const base: Record<string, unknown> = { type, content };
			if (record.classification) base.classification = record.classification;
			return base;
		}
		case "decision":
			if (!record.title || !record.rationale) return null;
			return withOptionalFields(
				{
					type,
					title: record.title,
					rationale: record.rationale,
				},
				record,
			);
		case "failure":
			if (!record.description || !record.resolution) return null;
			return withOptionalFields(
				{
					type,
					description: record.description,
					resolution: record.resolution,
				},
				record,
			);
		default:
			if (!record.name) return null;
			if (!record.description && !record.content) return null;
			return withOptionalFields(
				{
					type,
					name: record.name,
					...(record.description ? { description: record.description } : {}),
					...(record.content ? { content: record.content } : {}),
				},
				record,
			);
	}
}

function withOptionalFields(
	base: Record<string, unknown>,
	record: MulchDraftRecord,
): Record<string, unknown> {
	return {
		...base,
		...(record.classification ? { classification: record.classification } : {}),
		...(record.files && record.files.length > 0 ? { files: record.files } : {}),
		...(record.tags && record.tags.length > 0 ? { tags: record.tags } : {}),
	};
}

function normalizeType(type: MulchRecordType): MulchRecordType | null {
	return [
		"convention",
		"pattern",
		"failure",
		"decision",
		"reference",
		"guide",
	].includes(type)
		? type
		: null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: null;
}
