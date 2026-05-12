# Track: Draft records could still be low quality if extraction is too eager

**Status:** Open  
**Source:** Watchout item from pi-mulch-integration plan  
**Created:** 2026-05-12  

## Summary

When `draftMode` is `"session-end"`, the extension calls `mulch learn` on every session shutdown where the linter status is clean and at least one file was touched. The resulting draft file contains only placeholder records — TODO stubs with no real content. The review step is a raw JSON editor with no guidance or validation. Several vectors allow low-quality or noisy drafts to accumulate.

## Current Mitigations (already in place)

1. **Linter gating** — drafts are only created when `getLatestLinterStatus()` returns `"clean"`.
2. **Placeholder-only records** — `buildPlaceholderRecords()` creates records with `placeholder: true` and generic TODO text. `toBatchRecord()` returns `null` for placeholders, so they cannot be applied without human editing.
3. **Explicit review step** — `/mulch-apply` forces the user through a JSON editor and then a confirmation dialog.
4. **Zero touched files → skip** — `maybeWriteSessionDraft()` returns `null` when `touchedFiles.length === 0`.
5. **Opt-out** — `draftMode: "off"` disables automatic draft generation entirely.

## Risk Vectors

### 1. No session significance threshold

A session that touches 1 file (e.g., a typo fix) generates a draft just like a 20-file feature implementation. The only guard is `touchedFiles.length > 0`, so even trivial changes produce a draft file containing placeholder records.

**Impact:** Draft directory fills with low-signal files; users learn to ignore draft notifications.

### 2. Eager domain suggestion from `mulch learn`

`mulch learn` returns `suggestedDomains` — a list of domain names. The extension creates one placeholder record per suggested domain with no filtering, relevance scoring, or explanation of *why* the domain was suggested. If learn returns 10 domains for a trivial change, 10 placeholder records appear.

**Impact:** Draft records that have no meaningful connection to the actual work performed.

### 3. No cross-session draft deduplication

Three sessions touching overlapping files produce three separate draft files in `.mulch/drafts/`. Each draft independently calls `mulch learn` and may suggest the same domains. There is no consolidation or detection of overlap.

**Impact:** Repeated low-quality drafts for the same domains; user fatigue during review.

### 4. Raw JSON review with no validation

The `/mulch-review` and `/mulch-apply` commands open the draft as raw JSON in an editor. There is no:
- Schema validation after editing
- Guidance about what constitutes a useful record
- Warning about placeholder records that still have TODO text
- Pre-flight check that non-placeholder records have required fields before apply

**Impact:** Users can apply malformed or still-placeholder records if they don't manually validate the JSON.

### 5. Learn output quality is opaque

The extension stores the raw `learn` result in `MulchDraftFile.learn` but doesn't use it to inform record content. The `suggestedDomains` list is the only extracted data. If `mulch learn`'s heuristics are too broad (e.g., suggesting domains for files that were only read, not modified), the draft captures noise.

**Impact:** Drafts reflect Mulch's internal heuristics rather than the actual significance of the session's changes.

### 6. Read-only touches count

The `tool_call` and `tool_result` handlers add *any* extracted path to `touchedFiles`, including files that were only read (not written or edited). A session that reads many files but changes nothing still has a non-empty `touchedFiles` set, triggering draft generation.

**Impact:** Drafts generated for read-only sessions with no real changes to record.

## Recommended Mitigations

### Tier 1 — Low effort, high impact

| # | Mitigation | Where |
|---|-----------|-------|
| M1 | Add a configurable `minTouchedFiles` threshold (default: 2) so trivial 1-file sessions don't generate drafts. | `maybeWriteSessionDraft()` |
| M2 | Only count write/edit tool events toward the touched-files threshold, not read events. Add a `touchedFilesWritten` set alongside `touchedFiles`. | `index.ts` tool handlers, `state.ts` |
| M3 | Add pre-apply validation in `applyDraftFile()` that rejects records with `placeholder: true` or TODO-style `name`/`description` fields. | `draft.ts` → `toBatchRecord()` |
| M4 | Add a `maxDraftAge` config option and skip drafts older than this threshold during apply, with a warning. | `findLatestDraft()` |

### Tier 2 — Medium effort

| # | Mitigation | Where |
|---|-----------|-------|
| M5 | Add a `draftSignificance` heuristic: combine touched-file count, number of domains suggested, and whether any files were written. Skip drafts below a threshold. | `maybeWriteSessionDraft()` |
| M6 | Store `suggestedDomains` with an optional `reason` from `mulch learn` output; include the reason in the draft file and review UI. | `buildDraftFile()`, types |
| M7 | Add draft consolidation: when writing a new draft, check for an existing recent draft (same day) and merge domain suggestions instead of creating a new file. | New function in `draft.ts` |
| M8 | In the review editor, add a comment/header block explaining what fields mean and which records are still placeholders. | `commandReview()` in `index.ts` |

### Tier 3 — Larger scope

| # | Mitigation | Where |
|---|-----------|-------|
| M9 | Add a `mulch learn --diff` or `mulch learn --explain` CLI integration that returns richer suggestions (actual content hints, not just domain names). Use this to pre-populate record fields instead of leaving them as TODO placeholders. | `maybeWriteSessionDraft()`, `buildPlaceholderRecords()` |
| M10 | Add post-edit JSON schema validation in `/mulch-review` and `/mulch-apply`. Warn on missing required fields, placeholder text patterns, and invalid record types. | `commandReview()`, `commandApply()` |
| M11 | Track write vs. read intent in the session state, and pass write-touched files separately to `mulch learn`. | `state.ts`, `maybeWriteSessionDraft()` |

## Files Involved

| File | Role |
|------|------|
| `src/draft.ts` | Draft generation, learn invocation, placeholder record building, apply logic |
| `src/index.ts` | Session shutdown hook that triggers `maybeWriteSessionDraft()` |
| `src/types.ts` | `MulchDraftRecord`, `MulchDraftFile`, `MulchConfig` type definitions |
| `src/config.ts` | Config defaults and normalization (would add `minTouchedFiles`, `maxDraftAge`) |
| `src/state.ts` | Touched-file tracking and session state |
| `src/paths.ts` | Path extraction from tool events |
| `test/draft.test.ts` | Draft workflow tests |

## Validation

After implementing any mitigation:
1. Run `npx vitest run test/draft.test.ts` — existing tests must pass
2. Add new test cases for the specific mitigation (e.g., `minTouchedFiles` guard)
3. Run `npm run typecheck`
4. Run `npx @biomejs/biome check .`
5. Manual test: session with 1 trivial file change → verify no draft is created
6. Manual test: session with meaningful changes → verify draft still works
