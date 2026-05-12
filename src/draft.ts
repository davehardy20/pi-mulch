/**
 * Draft generation, review, and apply workflow.
 *
 * End-of-session drafts are written to .mulch/drafts/ and must only
 * be generated after the post-turn-linter has completed cleanly.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { resolve, join } from "node:path";
import type { DraftRecord, PiMulchConfig } from "./types.js";
import { runMulch } from "./exec.js";

const DRAFTS_DIR = ".mulch/drafts";

// ---------------------------------------------------------------------------
// Draft gating
// ---------------------------------------------------------------------------

/**
 * Determine whether draft generation should proceed.
 */
export function shouldGenerateDrafts(
  config: PiMulchConfig,
  linterStatus: string,
  draftInProgress: boolean,
  touchedFiles: string[],
): boolean {
  if (config.draftMode === "off") return false;
  if (linterStatus !== "clean") return false;
  if (draftInProgress) return false;
  if (touchedFiles.length === 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Get the drafts directory path for a repo.
 */
export function getDraftsDir(repoRoot: string): string {
  return resolve(repoRoot, DRAFTS_DIR);
}

/**
 * Ensure the drafts directory exists.
 */
export function ensureDraftsDir(repoRoot: string): string {
  const dir = getDraftsDir(repoRoot);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Generate a unique draft ID.
 */
function generateDraftId(): string {
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Generate drafts
// ---------------------------------------------------------------------------

/**
 * Generate drafts from session context.
 * Uses `mulch learn --json` to get domain suggestions, then creates drafts.
 */
export async function generateDrafts(
  command: string,
  files: string[],
  cwd: string,
  config: PiMulchConfig,
): Promise<DraftRecord[]> {
  if (files.length === 0) return [];

  ensureDraftsDir(cwd);

  // Run mulch learn to get suggestions
  const learnResult = await runMulch(command, ["learn", "--json"], cwd);
  const drafts: DraftRecord[] = [];

  if (learnResult.code === 0 && learnResult.stdout.trim()) {
    try {
      const suggestions = JSON.parse(learnResult.stdout) as {
        suggestedDomains?: Array<{ domain: string }>;
      };

      if (
        suggestions.suggestedDomains &&
        suggestions.suggestedDomains.length > 0
      ) {
        for (const suggestion of suggestions.suggestedDomains.slice(0, 5)) {
          const id = generateDraftId();
          const record: DraftRecord = {
            id,
            domain: suggestion.domain,
            type: "convention",
            content: `Session touched: ${files.join(", ")}`,
            files,
            filePath: join(getDraftsDir(cwd), `${id}.json`),
            createdAt: new Date().toISOString(),
            applied: false,
          };
          writeFileSync(
            record.filePath!,
            JSON.stringify(record, null, 2),
            "utf-8",
          );
          drafts.push(record);
        }
        return drafts;
      }
    } catch {
      // Fall through to auto-learn domains
    }
  }

  // Fallback: use autoLearnDomains from config
  if (config.autoLearnDomains.length > 0) {
    for (const domain of config.autoLearnDomains) {
      const id = generateDraftId();
      const record: DraftRecord = {
        id,
        domain,
        type: "convention",
        content: `Session touched: ${files.join(", ")}`,
        files,
        filePath: join(getDraftsDir(cwd), `${id}.json`),
        createdAt: new Date().toISOString(),
        applied: false,
      };
      writeFileSync(
        record.filePath!,
        JSON.stringify(record, null, 2),
        "utf-8",
      );
      drafts.push(record);
    }
  }

  return drafts;
}

// ---------------------------------------------------------------------------
// List / get / read drafts
// ---------------------------------------------------------------------------

/**
 * List all unapplied draft records, sorted by date descending.
 */
export function listDrafts(repoRoot: string): DraftRecord[] {
  const dir = getDraftsDir(repoRoot);
  if (!existsSync(dir)) return [];

  const drafts: DraftRecord[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    try {
      const content = readFileSync(join(dir, entry), "utf-8");
      const record = JSON.parse(content) as DraftRecord;
      if (!record.applied) {
        drafts.push(record);
      }
    } catch {
      // Skip malformed drafts
    }
  }

  return drafts.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/**
 * Retrieve a specific draft by ID.
 */
export function getDraft(
  repoRoot: string,
  draftId: string,
): DraftRecord | null {
  const drafts = listDrafts(repoRoot);
  return drafts.find((d) => d.id === draftId) ?? null;
}

/**
 * Alias for getDraft.
 */
export function readDraft(
  repoRoot: string,
  draftId: string,
): DraftRecord | null {
  return getDraft(repoRoot, draftId);
}

// ---------------------------------------------------------------------------
// Delete / remove / clear drafts
// ---------------------------------------------------------------------------

/**
 * Delete a draft file.
 */
export function deleteDraft(repoRoot: string, draftId: string): boolean {
  const dir = getDraftsDir(repoRoot);
  if (!existsSync(dir)) return false;

  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    try {
      const content = readFileSync(join(dir, entry), "utf-8");
      const record = JSON.parse(content) as DraftRecord;
      if (record.id === draftId) {
        unlinkSync(join(dir, entry));
        return true;
      }
    } catch {
      // skip
    }
  }

  return false;
}

/**
 * Alias for deleteDraft.
 */
export function removeDraft(repoRoot: string, draftId: string): boolean {
  return deleteDraft(repoRoot, draftId);
}

/**
 * Delete all pending drafts and return the count removed.
 */
export function clearDrafts(repoRoot: string): number {
  const pending = listDrafts(repoRoot);
  for (const draft of pending) {
    deleteDraft(repoRoot, draft.id);
  }
  return pending.length;
}

// ---------------------------------------------------------------------------
// Mark applied
// ---------------------------------------------------------------------------

/**
 * Mark a draft as applied.
 */
export function markDraftApplied(repoRoot: string, draftId: string): void {
  const dir = getDraftsDir(repoRoot);
  if (!existsSync(dir)) return;

  let targetPath: string | null = null;
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    const candidatePath = join(dir, entry);
    try {
      const content = readFileSync(candidatePath, "utf-8");
      const record = JSON.parse(content) as DraftRecord;
      if (record.id === draftId) {
        targetPath = candidatePath;
        break;
      }
    } catch {
      // skip
    }
  }

  if (!targetPath) return;

  try {
    const content = readFileSync(targetPath, "utf-8");
    const record = JSON.parse(content) as DraftRecord;
    record.applied = true;
    writeFileSync(targetPath, JSON.stringify(record, null, 2), "utf-8");
  } catch {
    // Best effort
  }
}

// ---------------------------------------------------------------------------
// Preview / apply / review
// ---------------------------------------------------------------------------

/**
 * Preview applying a draft (dry-run).
 */
export async function previewDraft(
  _command: string,
  _repoRoot: string,
  draft: DraftRecord,
): Promise<{ success: boolean; output: string }> {
  // In a real implementation, this would run `mulch record --dry-run`
  return {
    success: true,
    output: `Would create record in domain "${draft.domain}" with type "${draft.type}"`,
  };
}

/**
 * Apply a draft by converting it to a `mulch record` command.
 */
export async function applyDraft(
  command: string,
  draftOrRepoRoot: DraftRecord | string,
  cwdOrDraftId?: string,
  signal?: AbortSignal,
): Promise<{ success: boolean; output: string }> {
  // Two calling conventions:
  // 1. applyDraft(command, draft: DraftRecord, cwd, signal?)
  // 2. applyDraft(command, repoRoot, draftId) — from tests

  if (typeof draftOrRepoRoot === "string") {
    // Convention 2: repoRoot + draftId
    const repoRoot = draftOrRepoRoot;
    const draftId = cwdOrDraftId ?? "";
    const draft = getDraft(repoRoot, draftId);
    if (!draft) {
      return { success: false, output: `Draft ${draftId} not found` };
    }
    return applyDraftRecord(command, draft, repoRoot, signal);
  }

  // Convention 1: DraftRecord + cwd
  const draft = draftOrRepoRoot;
  const cwd = cwdOrDraftId ?? ".";
  return applyDraftRecord(command, draft, cwd, signal);
}

async function applyDraftRecord(
  command: string,
  draft: DraftRecord,
  cwd: string,
  signal?: AbortSignal,
): Promise<{ success: boolean; output: string }> {
  const args = [
    "record",
    draft.domain,
    draft.content ?? "",
    "--type",
    draft.type,
  ];

  const result = await runMulch(command, args, cwd, signal);

  if (result.code !== 0) {
    return {
      success: false,
      output: `Failed to apply draft: ${result.stderr || result.stdout}`,
    };
  }

  return {
    success: true,
    output: result.stdout || "Draft applied successfully.",
  };
}

/**
 * Apply all pending drafts.
 */
export async function applyAllDrafts(
  command: string,
  repoRoot: string,
): Promise<Array<{ draft: DraftRecord; result: { success: boolean; output: string } }>> {
  const pending = listDrafts(repoRoot);
  const results: Array<{
    draft: DraftRecord;
    result: { success: boolean; output: string };
  }> = [];

  for (const draft of pending) {
    const result = await applyDraft(command, draft, repoRoot);
    results.push({ draft, result });
  }

  return results;
}

/**
 * Review all pending drafts (preview each one).
 */
export async function reviewDrafts(
  command: string,
  repoRoot: string,
): Promise<
  Array<{
    draft: DraftRecord;
    preview: { success: boolean; output: string };
  }>
> {
  const pending = listDrafts(repoRoot);
  const reviews: Array<{
    draft: DraftRecord;
    preview: { success: boolean; output: string };
  }> = [];

  for (const draft of pending) {
    const preview = await previewDraft(command, repoRoot, draft);
    reviews.push({ draft, preview });
  }

  return reviews;
}

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

/**
 * Format a single draft for display.
 */
export function formatDraftForDisplay(draft: DraftRecord): string {
  const lines: string[] = [];
  lines.push(`ID: ${draft.id}`);
  lines.push(`Domain: ${draft.domain}`);
  lines.push(`Type: ${draft.type}`);
  if (draft.title) lines.push(`Title: ${draft.title}`);
  if (draft.name) lines.push(`Name: ${draft.name}`);
  if (draft.description) lines.push(`Description: ${draft.description}`);
  if (draft.content) lines.push(`Content: ${draft.content}`);
  if (draft.resolution) lines.push(`Resolution: ${draft.resolution}`);
  if (draft.rationale) lines.push(`Rationale: ${draft.rationale}`);
  lines.push(
    `Files: ${draft.files.length > 0 ? draft.files.join(", ") : "(none)"}`,
  );
  lines.push(`Created: ${draft.createdAt}`);
  lines.push(`Status: ${draft.applied ? "applied" : "pending"}`);
  return lines.join("\n");
}

/**
 * Format review results for display.
 */
export function formatReviewForDisplay(
  reviews: Array<{
    draft: DraftRecord;
    preview: { success: boolean; output: string };
  }>,
): string {
  if (reviews.length === 0) {
    return "No pending drafts to review.";
  }

  const parts: string[] = [];
  for (let i = 0; i < reviews.length; i++) {
    const { draft, preview } = reviews[i];
    parts.push(`--- Draft ${i + 1} of ${reviews.length} ---`);
    parts.push(formatDraftForDisplay(draft));
    parts.push(`Preview: ${preview.output}`);
    parts.push(`Preview status: ${preview.success ? "ok" : "error"}`);
    parts.push("");
  }
  return parts.join("\n").trimEnd();
}
