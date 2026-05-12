/**
 * Touched-file tracking and path normalization.
 *
 * Tracks file paths from read/write/edit and similar tool activity
 * to enable file-scoped priming in later turns.
 */

import { relative, normalize, resolve } from "node:path";
import type { MulchSessionState } from "./types.js";
import { normalizeFilePath } from "./exec.js";

/**
 * Detect file paths from tool call events.
 * Returns normalized absolute paths.
 */
export function detectTouchedFilesFromToolEvent(
  event: {
    toolName?: string;
    args?: Record<string, unknown>;
    input?: Record<string, unknown>;
  },
  cwd: string,
): string[] {
  const params = event.args ?? event.input;
  if (!params || typeof params !== "object") return [];

  switch (event.toolName) {
    case "write":
    case "edit":
    case "create_text_file": {
      const rawPath = typeof params.path === "string" ? params.path : undefined;
      const normalized = normalizeFilePath(rawPath, cwd);
      return normalized ? [normalized] : [];
    }
    case "hashline_edit": {
      const rawPath =
        typeof params.filePath === "string" ? params.filePath : undefined;
      const rename =
        typeof params.rename === "string" ? params.rename : undefined;
      const results: string[] = [];
      if (rawPath) {
        const normalized = normalizeFilePath(rawPath, cwd);
        if (normalized) results.push(normalized);
      }
      if (rename) {
        const normalized = normalizeFilePath(rename, cwd);
        if (normalized) results.push(normalized);
      }
      return results;
    }
    case "read": {
      const rawPath = typeof params.path === "string" ? params.path : undefined;
      const normalized = normalizeFilePath(rawPath, cwd);
      return normalized ? [normalized] : [];
    }
    case "lsp_rename": {
      const rawPath =
        typeof params.filePath === "string" ? params.filePath : undefined;
      const normalized = normalizeFilePath(rawPath, cwd);
      return normalized ? [normalized] : [];
    }
    case "ast_grep_replace": {
      const paths = params.paths;
      if (Array.isArray(paths)) {
        return paths
          .map((p: unknown) =>
            typeof p === "string" ? normalizeFilePath(p, cwd) : null,
          )
          .filter((p: string | null): p is string => Boolean(p));
      }
      return [];
    }
    default:
      return [];
  }
}

/**
 * Detect file paths from tool result events.
 * Reads modifiedFiles from the shared contract details.
 * Returns null for unhandled tools.
 */
export function detectTouchedFilesFromToolResult(
  event: {
    toolName?: string;
    result?: Record<string, unknown>;
  },
  cwd: string,
): string[] | null {
  // Shared contract: any mutating tool can emit details.modifiedFiles
  if (event.result?.details) {
    const details = event.result.details as Record<string, unknown>;
    const modifiedFiles = details.modifiedFiles;
    if (Array.isArray(modifiedFiles)) {
      return modifiedFiles
        .map((p: unknown) =>
          typeof p === "string" ? normalizeFilePath(p, cwd) : null,
        )
        .filter((p: string | null): p is string => Boolean(p));
    }
  }

  // Legacy fallback for lsp_rename
  if (event.toolName === "lsp_rename" && event.result?.details) {
    const details = event.result.details as Record<string, unknown>;
    const edit = details.edit as Record<string, unknown> | undefined;
    if (edit?.changes) {
      const changes = edit.changes as Record<string, unknown[]>;
      return Object.keys(changes)
        .map((uri: string) => {
          try {
            return normalizeFilePath(new URL(uri).pathname, cwd);
          } catch {
            return null;
          }
        })
        .filter((p: string | null): p is string => Boolean(p));
    }
  }

  return null;
}

/**
 * Get touched files relative to a given root path.
 */
export function getTouchedFilesRelative(
  state: MulchSessionState,
  root: string,
): string[] {
  const result: string[] = [];
  for (const absPath of state.touchedFiles) {
    try {
      const rel = relative(root, absPath);
      if (!rel.startsWith("..") && !rel.startsWith("/")) {
        result.push(rel);
      }
    } catch {
      // Skip invalid paths
    }
  }
  return result.sort();
}
