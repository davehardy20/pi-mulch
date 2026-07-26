import * as path from "node:path";
import type {
	ToolCallEvent,
	ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { normalizePath, uriToNormalizedPath } from "./path-utils.js";

export interface TouchedFileTracker {
	add(rawPath: string, cwd?: string): void;
	addAll(rawPaths: readonly string[], cwd?: string): void;
	has(filePath: string): boolean;
	getAll(): string[];
	clear(): void;
	readonly size: number;
}

export function createTouchedFileTracker(): TouchedFileTracker {
	const touched = new Set<string>();

	function add(rawPath: string, cwd?: string): void {
		const normalized = normalizeInputPath(rawPath, cwd);
		if (normalized !== null) {
			touched.add(normalized);
		}
	}

	return {
		add,
		addAll(rawPaths, cwd) {
			for (const rawPath of rawPaths) {
				add(rawPath, cwd);
			}
		},
		has(filePath) {
			const normalized = normalizeInputPath(filePath);
			return normalized === null ? false : touched.has(normalized);
		},
		getAll() {
			return Array.from(touched).sort();
		},
		clear() {
			touched.clear();
		},
		get size() {
			return touched.size;
		},
	};
}

export function normalizeInputPath(
	rawPath: unknown,
	cwd?: string,
): string | null {
	if (typeof rawPath !== "string") return null;
	const trimmed = rawPath.trim();
	if (!trimmed) return null;

	if (/^file:\/\//i.test(trimmed)) {
		return uriToNormalizedPath(trimmed);
	}

	const resolved = path.isAbsolute(trimmed)
		? trimmed
		: cwd
			? path.resolve(cwd, trimmed)
			: trimmed;

	return normalizePath(resolved);
}

export function extractPathsFromToolCall(event: ToolCallEvent): string[] {
	const input = asRecord(event.input);
	if (input === null) return [];

	switch (event.toolName) {
		case "read":
		case "write":
		case "edit":
		case "ls":
		case "find":
		case "grep":
			return pickStrings(input.path);
		case "bash":
			return extractPathsFromBashCommand(
				typeof input.command === "string" ? input.command : "",
			);
		default:
			return extractPathsFromCustomToolInput(input);
	}
}

export function extractPathsFromToolResult(event: ToolResultEvent): string[] {
	const input = asRecord(event.input);
	if (input === null) return [];

	switch (event.toolName) {
		case "read":
		case "write":
		case "edit":
		case "ls":
		case "find":
		case "grep":
			return pickStrings(input.path);
		case "bash":
			return extractPathsFromBashCommand(
				typeof input.command === "string" ? input.command : "",
			);
		default:
			return extractPathsFromCustomToolInput(input);
	}
}

export function extractPathsFromToolResultDetails(details: unknown): string[] {
	const record = asRecord(details);
	if (record === null) {
		return [];
	}

	const paths: string[] = [];
	for (const key of ["modifiedFiles", "files", "filePaths", "paths"]) {
		paths.push(...pickStrings(record[key]));
	}
	collectCustomToolPaths(record, paths);
	return [...new Set(paths)];
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (typeof value === "object" && value !== null) {
		return value as Record<string, unknown>;
	}
	return null;
}

function pickStrings(value: unknown): string[] {
	if (typeof value === "string" && value.trim()) {
		return [value.trim()];
	}
	if (Array.isArray(value)) {
		return value
			.filter(
				(entry): entry is string =>
					typeof entry === "string" && entry.trim().length > 0,
			)
			.map((entry) => entry.trim());
	}
	return [];
}

export function extractPathsFromBashCommand(command: string): string[] {
	if (typeof command !== "string") return [];

	const paths: string[] = [];
	const commandRegex =
		/\b(cat|less|head|tail|touch|mkdir|rmdir|rm|cp|mv|diff|git\s+add|git\s+rm|git\s+checkout|git\s+show|git\s+diff)\b/gi;

	let commandMatch = commandRegex.exec(command);
	while (commandMatch !== null) {
		const afterCommand = command.slice(
			commandMatch.index + commandMatch[0].length,
		);
		const segment = afterCommand.split(/[;|&]/)[0] ?? "";
		const args = tokenizeShell(segment);

		for (const arg of args) {
			if (arg.startsWith("-")) continue;
			if (isLikelyFileArg(arg)) {
				paths.push(arg);
			}
		}

		commandMatch = commandRegex.exec(command);
	}

	const redirectPattern = /[<>]{1,2}\s*["']?([^"'\s;|&<>]+)/g;
	let redirectMatch = redirectPattern.exec(command);
	while (redirectMatch !== null) {
		const candidate = redirectMatch[1];
		if (candidate && looksLikePath(candidate)) {
			paths.push(candidate);
		}
		redirectMatch = redirectPattern.exec(command);
	}

	const flagPattern =
		/(?:\B-(?:f|i|o|c|C|p)\s+|\B--(?:file|path|output|out|input|config|dir|directory|cwd|root|source|target)(?:=|\s+))["']?([^"'\s;|&<>]+)/gi;
	let flagMatch = flagPattern.exec(command);
	while (flagMatch !== null) {
		const candidate = flagMatch[1];
		if (candidate && isLikelyFileArg(candidate)) {
			paths.push(candidate);
		}
		flagMatch = flagPattern.exec(command);
	}

	return [...new Set(paths)];
}

function tokenizeShell(segment: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let inQuote: '"' | "'" | null = null;

	for (let index = 0; index < segment.length; index += 1) {
		const char = segment[index];
		if (!char) continue;

		if (inQuote) {
			if (char === inQuote) {
				inQuote = null;
				tokens.push(current);
				current = "";
			} else {
				current += char;
			}
			continue;
		}

		if (char === '"' || char === "'") {
			if (current) {
				tokens.push(current);
				current = "";
			}
			inQuote = char;
			continue;
		}

		if (/\s/.test(char)) {
			if (current) {
				tokens.push(current);
				current = "";
			}
			continue;
		}

		if (/[;|&<>]/.test(char)) {
			if (current) {
				tokens.push(current);
			}
			break;
		}

		current += char;
	}

	if (current) {
		tokens.push(current);
	}

	return tokens;
}

function isLikelyFileArg(candidate: string): boolean {
	if (candidate.length < 1) return false;
	if (candidate.startsWith("-")) return false;
	if (candidate.startsWith("$")) return false;
	if (candidate.startsWith("`")) return false;
	if (/^\d+$/.test(candidate)) return false;
	if (/^(true|false|null|undefined|and|or|not)$/i.test(candidate)) return false;
	if (
		/^(HEAD|FETCH_HEAD|ORIG_HEAD|MERGE_HEAD|CHERRY_PICK_HEAD)$/.test(candidate)
	) {
		return false;
	}
	if (candidate === "<" || candidate === ">") return false;
	return true;
}

function looksLikePath(candidate: string): boolean {
	if (!isLikelyFileArg(candidate)) return false;
	if (
		!candidate.includes("/") &&
		!candidate.includes("\\") &&
		!candidate.startsWith(".") &&
		!candidate.includes(".")
	) {
		return false;
	}
	return true;
}

function extractPathsFromCustomToolInput(
	input: Record<string, unknown>,
): string[] {
	const paths: string[] = [];
	collectCustomToolPaths(input, paths);
	return [...new Set(paths)];
}

const PATH_FIELD_NAMES = new Set([
	"path",
	"paths",
	"file",
	"files",
	"filepath",
	"filepaths",
	"filename",
	"filenames",
	"fileuri",
	"fileuris",
	"dir",
	"dirs",
	"directory",
	"directories",
	"cwd",
	"root",
	"roots",
	"target",
	"targets",
	"source",
	"sources",
	"uri",
	"uris",
	"oldpath",
	"newpath",
	"olduri",
	"newuri",
	"modifiedfiles",
]);

function collectCustomToolPaths(
	value: unknown,
	paths: string[],
	key?: string,
): void {
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (!trimmed || !key) return;

		if (/^file:\/\//i.test(trimmed)) {
			if (PATH_FIELD_NAMES.has(normalizeFieldName(key))) {
				paths.push(trimmed);
			}
			return;
		}

		if (
			PATH_FIELD_NAMES.has(normalizeFieldName(key)) &&
			(looksLikePath(trimmed) || isLikelyFileArg(trimmed))
		) {
			paths.push(trimmed);
		}
		return;
	}

	if (Array.isArray(value)) {
		for (const entry of value) {
			collectCustomToolPaths(entry, paths, key);
		}
		return;
	}

	const record = asRecord(value);
	if (record === null) {
		return;
	}

	for (const [entryKey, entryValue] of Object.entries(record)) {
		collectCustomToolPaths(entryValue, paths, entryKey);
	}
}

function normalizeFieldName(key: string): string {
	return key.replace(/[^a-zA-Z]/g, "").toLowerCase();
}
