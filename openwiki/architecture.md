# Architecture

<!-- markdownlint-disable MD013 -->

This page covers the configuration model, type system, core patterns, and invariants of pi-mulch.

---

## Configuration model

**Source of truth:** `~/.pi/agent/settings.json` → top-level `"mulch"` object.  
**Defaults:** `DEFAULT_MULCH_CONFIG` in `/src/config.ts`.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `enabled` | `boolean` | `true` | Master switch for all hooks and tools. |
| `command` | `string \| null` | `null` | Explicit CLI binary override. Honored **only** from global settings. |
| `cliCandidates` | `string[]` | `["mulch", "ml"]` | Auto-detection fallback order. Deduplicated. |
| `injectionMode` | `"manifest"` | `"manifest"` | Only `"manifest"` is currently supported. |
| `primeBudget` | `number` | `4000` | Character budget passed to `mulch prime --budget`. |
| `outputMaxChars` | `number` | `6000` | Bound on tool output summaries. |
| `promptOnMissingInit` | `boolean` | `true` | Offer to run `mulch init` when global `~/.mulch/` is missing. |
| `persistInitDecline` | `boolean` | `true` | Persist init refusal to repo-local state file. |
| `draftMode` | `"off" \| "session-end"` | `"session-end"` | Controls automatic draft generation. |
| `draftDir` | `string` | `.mulch/drafts` | Confined to active Mulch store root. |
| `initStateFile` | `string` | `.pi/mulch-integration.json` | **Confined to repo root.** |
| `maxTrackedFiles` | `number` | `24` | Cap on files passed to file-scoped prime. |
| `llmTools` | `MulchCallableToolName[]` | all 5 tools | Which tools to register. Invalid names filtered out. |

### Normalization (`normalizeMulchConfig` in `/src/config.ts`)

Every field has type-coercion + fallback-to-default logic. Key behaviors:

- Arrays are filtered to strings, trimmed, deduplicated.
- `llmTools` is additionally filtered against the five known tool names; unknown entries are silently dropped.
- Numbers must be `> 0`; otherwise the default is used.
- A missing or unparseable settings file yields `{}` → all defaults.

### Config loading chain

```text
loadMulchConfig(cwd)           // src/config.ts
  → getGlobalSettingsPath()    // ~/.pi/agent/settings.json
  → readSettingsFile()         // JSON.parse with try/catch → {} on failure
  → extractMulchSettings()     // top-level .mulch key only
  → normalizeMulchConfig()     // type-coerce + default-fill
```

---

## Type system

All shared types live in `/src/types.ts`.

### Detection result (`MulchDetectionResult`, `/src/detect.ts`)

Returned by `detectMulch()`. Key fields:

- `cliAvailable` / `cliCommand` — resolved binary name (`null` if none found).
- `directoryExists` / `directoryPath` — whether any Mulch store exists, preferring global `~/.mulch/`.
- `globalDirectory*` — primary global store fields for `~/.mulch/`.
- `projectDirectory*` — secondary repo `.mulch/` fields when an existing project store is present.
- `isGitRepo` / `gitRepoRoot` — git root from `git rev-parse --show-toplevel`.
- `isWorktree` / `mainWorktreeRoot` — linked-worktree detection via `--git-common-dir`.
- `commandCwd` — the working directory for primary Mulch CLI calls. Normally the home directory for global `~/.mulch/`, with project scope cwd retained separately for secondary reads.
- `ready` — `cliAvailable && directoryExists`.

### Draft types

```text
MulchDraftFile (version: 1)
  ├── linterStatus: "unknown" | "clean" | "findings" | "error"
  ├── touchedFiles: string[]      (absolute for global-store drafts; repo-relative for project-store drafts)
  ├── learn: unknown             (raw mulch learn output)
  ├── records: MulchDraftRecord[]
  └── appliedAt?, applyResults?  (set after apply)

MulchDraftRecord
  ├── domain: string             (required)
  ├── type: MulchRecordType       (convention | pattern | failure | decision | reference | guide)
  ├── classification?: foundational | tactical | observational
  ├── placeholder?: boolean       (true → skipped during apply)
  └── type-specific fields (see toBatchRecord in draft.ts)

Global-store drafts also use absolute paths in each generated record's `files` field. Project-store drafts retain repository-relative paths.
```

### Record type → batch requirements (`toBatchRecord` in `/src/draft.ts`)

Each `MulchRecordType` has different required fields to be "actionable" (non-null) for apply:

| Type | Required fields |
|------|----------------|
| `convention` | `content` (or `description` as fallback) |
| `decision` | `title`, `rationale` |
| `failure` | `description`, `resolution` |
| `pattern`, `reference`, `guide` | `name` + (`description` or `content`) |

Records with `placeholder: true` always return `null` — they cannot be applied without manual editing.

---

## Core patterns

### Dependency injection

Nearly every public function accepts a `*Deps` parameter for filesystem/process operations:

```typescript
export function detectMulch(cwd, options, deps: DetectDeps = {}): MulchDetectionResult
export function loadMulchConfig(_cwd, deps: LoadConfigDeps = {}): MulchConfig
export async function runMulchCommand(options, deps: RunMulchCommandDeps = {})
```

This makes every function fully testable without touching real I/O. Tests pass mock `readFileSync`, `execFileSync`, `execFile`, etc. **When adding new I/O operations, follow this pattern.**

### Extension factory with optional deps (`/src/index.ts`)

```typescript
export default function mulchIntegrationExtension(
  pi: ExtensionAPI,
  deps: MulchExtensionDeps = {},
): void
```

`MulchExtensionDeps` allows injecting `loadConfig`, `detectMulch`, and `runMulchCommand` — used by integration tests to avoid real CLI/git calls.

---

## Invariants

These must not be violated without careful consideration:

1. **Path confinement.** `draftDir` is resolved inside the active Mulch store root (normally the home directory for `~/.mulch`), while `initStateFile` remains resolved inside the repo root via `resolvePathInsideRoot()` (`/src/path-utils.ts`). If a configured path escapes its root, the default is used.

2. **Global-only config for sensitive fields.** `command` and `cliCandidates` are only honored from `~/.pi/agent/settings.json`. Repo-local `.pi/settings.json` is ignored. This is documented in `/README.md` and enforced by `loadMulchConfig` only reading the global file.

3. **Draft generation gating.** `maybeWriteSessionDraft()` (`/src/draft.ts`) requires ALL of:
   - `draftMode === "session-end"`
   - `detection.ready` (CLI available + global or existing project `.mulch/` exists)
   - `detection.gitRepoRoot` is non-null
   - `touchedFiles.length > 0`
   - Latest linter status is `"clean"`
   - At least one touched file is inside the repo root

4. **Placeholder records never applied.** `toBatchRecord()` returns `null` for any record with `placeholder: true`, regardless of other fields. This is the safety mechanism preventing TODO stubs from becoming real Mulch records.

5. **Prime injection deduplication.** `shouldInjectPrime()` checks both signature and content. Re-injection is skipped if neither changed. This prevents redundant context on every `before_agent_start`.

6. **Global-first store resolution.** Detection prefers the global `~/.mulch/` store. Existing repo or main-worktree `.mulch/` directories are kept as secondary project read scopes so older project expertise is still visible.

7. **Max buffer.** `runMulchCommand` uses `maxBuffer: 2_000_000` (2 MB). Commands producing more output will fail. *(verify in source: `/src/exec.ts` line ~42)*

---

## Source map: key exports

| Module | Key exports |
|--------|-------------|
| `/src/config.ts` | `DEFAULT_MULCH_CONFIG`, `loadMulchConfig`, `normalizeMulchConfig`, `getGlobalSettingsPath` |
| `/src/detect.ts` | `detectMulch`, `MulchDetectionResult`, `DetectOptions`, `DetectDeps` |
| `/src/exec.ts` | `runMulchCommand`, `formatMulchResult`, `RunMulchCommandOptions`, `RunMulchCommandDeps` |
| `/src/prime.ts` | `buildPrimeRequest`, `createPrimeInjection`, `shouldInjectPrime` |
| `/src/paths.ts` | `createTouchedFileTracker`, `extractPathsFromToolCall`, `extractPathsFromToolResult`, `extractPathsFromToolResultDetails`, `extractPathsFromBashCommand`, `TouchedFileTracker` |
| `/src/path-utils.ts` | `normalizePath`, `uriToNormalizedPath`, `toRepoRelativePath`, `isPathInsideRoot`, `resolvePathInsideRoot` |
| `/src/state.ts` | `createMulchSessionState`, `resetMulchSessionState`, `loadRepoInitState`, `saveRepoInitState`, `shouldOfferInitPrompt`, `getRepoInitStatePath`, `MulchSessionState` |
| `/src/draft.ts` | `maybeWriteSessionDraft`, `buildDraftFile`, `writeDraftFile`, `findLatestDraft`, `loadDraftFile`, `saveDraftFile`, `applyDraftFile`, `getLatestLinterStatus`, `getActionableDraftRecords`, `DraftFsDeps` |
| `/src/tools.ts` | `registerMulchTools`, `ToolRuntime` |
| `/src/types.ts` | All shared interfaces and union types |
| `/src/index.ts` | `mulchIntegrationExtension` (default export), `MulchExtensionDeps` |

---

## Safe-edit guidance

- **Adding a new config field:** Add to `MulchConfig` in `/src/types.ts`, add default in `DEFAULT_MULCH_CONFIG`, add normalization logic in `normalizeMulchConfig`, add a test in `/test/config.test.ts`.
- **Adding a new LLM tool:** Add the tool name to `MulchCallableToolName` in `/src/types.ts`, add registration block in `/src/tools.ts` under `registerMulchTools`, add the tool name to the `llmTools` filter in `normalizeMulchConfig`.
- **Adding a new user command:** Add a `pi.registerCommand(...)` block in `/src/index.ts`. Destructive commands should gate on `ctx.hasUI` + `ctx.ui.confirm()`.
- **Changing path extraction rules:** Edit `/src/paths.ts`. Be aware that `extractPathsFromBashCommand` uses regex heuristics — changes affect what files appear in drafts.
- **Changing draft record structure:** Update `MulchDraftRecord` in `/src/types.ts` and `toBatchRecord` in `/src/draft.ts`. The batch record format is what `mulch record --batch` expects.
