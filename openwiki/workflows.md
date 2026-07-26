# Workflows

<!-- markdownlint-disable MD013 -->

This page traces the major runtime workflows through the codebase: the Pi lifecycle, detection, file tracking, prime injection, and the draft lifecycle.

---

## Pi lifecycle hooks

The extension registers five hooks in `/src/index.ts`. All handlers are async.

| Hook | When | What it does |
|------|------|-------------|
| `session_start` | Session begins (startup, new, resume, fork, **reload**) | On reload: re-detect only, preserve state. Otherwise: reset session state (preserve `initPromptedRepos`), refresh config + detection, set status, offer init prompt. |
| `tool_call` | Before any Pi tool executes | Extract paths from the tool call input, add to `touchedFiles`, update status. |
| `tool_result` | After any Pi tool completes | Extract paths from tool result input + details, add to `touchedFiles`, update status. |
| `before_agent_start` | Before the agent processes a user prompt | Store `lastUserPrompt`. If Mulch is ready, build and inject prime context (hidden). |
| `session_shutdown` | Session ends (quit, new, resume, fork — **not reload**) | If not reload: attempt session-end draft generation. Clear status bar. |

**Session reload behavior:** On reload, `session_start` re-detects but does not reset state. `session_shutdown` skips draft generation for reload events. This is because a reload replaces the extension instance but the session continues.

---

## Detection flow

`detectMulch()` in `/src/detect.ts` runs at session start.

```text
detectMulch(cwd, options)
  ├── findGitRepoRoot(cwd)            // git rev-parse --show-toplevel
  │     → gitRepoRoot or null (falls back to cwd)
  ├── resolveWorktreeInfo(repoRoot)   // git rev-parse --git-common-dir
  │     → isWorktree, mainWorktreeRoot
  ├── Resolve Mulch stores:
  │     1. Check ~/.mulch as the primary global store
  │     2. Check repoRoot/.mulch as a secondary project read scope
  │     3. If not found AND isWorktree: check mainWorktreeRoot/.mulch
  │        → project scope commandCwd = mainWorktreeRoot if found
  ├── resolveCliCommand(options)      // probe candidates with --version
  │     1. Explicit command override (if non-empty string)
  │     2. cliCandidates (or DEFAULT_CLI_CANDIDATES)
  │     → first that succeeds --version becomes cliCommand
  └── Return MulchDetectionResult { ..., ready: cliAvailable && directoryExists }
```

### CLI resolution order

1. `options.command` (from config `command` field) if it's a non-empty string.
2. Each entry in `options.cliCandidates` (deduplicated) — probed with `<candidate> --version`.
3. If none succeed, `cliCommand` is `null` and `cliAvailable` is `false`.

Both `mulch` and `ml` are valid binary names. The extension does not assume which is installed.

---

## Touched-file tracking

The `TouchedFileTracker` (`/src/paths.ts`) is a normalized `Set<string>` populated from two sources:

### From `tool_call` and `tool_result` events

`extractPathsFromToolCall()` and `extractPathsFromToolResult()` handle known Pi tools:

| Tool | Extraction method |
|------|------------------|
| `read`, `write`, `edit`, `ls`, `find`, `grep` | `input.path` field |
| `bash` | `extractPathsFromBashCommand(input.command)` — regex heuristics |
| Other/custom | `extractPathsFromCustomToolInput()` — recursive scan for path-like field names |

### From `tool_result` details

`extractPathsFromToolResultDetails()` scans `event.details` for keys: `modifiedFiles`, `files`, `filePaths`, `paths`, plus recursive custom-tool path collection.

### Bash command path extraction

`extractPathsFromBashCommand()` in `/src/paths.ts` parses shell commands for file paths using three regex patterns:

1. **Known commands** (`cat`, `less`, `head`, `tail`, `touch`, `mkdir`, `rmdir`, `rm`, `cp`, `mv`, `diff`, `git add/rm/checkout/show/diff`) — extract non-flag arguments after the command.
2. **Redirects** (`>`, `<`, `>>`, `<<`) — extract the target file.
3. **Path-bearing flags** (`-f`, `-o`, `--file`, `--output`, `--dir`, etc.) — extract the value.

Arguments are filtered by `isLikelyFileArg()` and `looksLikePath()` to exclude flags, numbers, booleans, git refs (`HEAD`, `FETCH_HEAD`, etc.), and bare words without path separators.

**Limitation:** read-only file accesses (e.g., `cat file`) are counted as "touched" — this is a known design tradeoff documented in `/docs/tracking/draft-quality-eager-extraction.md`.

---

## Prime injection flow

Triggered by `before_agent_start` in `/src/index.ts`. Delegates to `/src/prime.ts`.

```text
buildPrimeRequest(detection, touchedFiles, config)
  ├── If touchedFiles has repo-absolute paths:
  │     mode = "files"
  │     args = ["prime", "--files", ...scopedFiles, "--budget", N, "--format", "plain"]
  │     signature = `files:<files>:<budget>`
  └── Else:
        mode = "manifest"
        args = ["prime", "--manifest", "--budget", N, "--format", "plain"]
        signature = `manifest:<budget>`

createPrimeInjection(...)
  → getMulchStoreScopes(detection)
  → runMulchCommand({ command, args, cwd: scope.commandCwd }) for each scope
  → skip failed or empty scope output
  → return combined global/project output separated by headings

shouldInjectPrime(lastSignature, lastContent, nextInjection)
  → true only if signature OR content changed since last injection
```

- **File-scoped mode** activates when the session has touched files inside the repo root. Global-store scopes keep absolute paths; project-store scopes convert them to repository-relative paths. Files are capped at `maxTrackedFiles` (default 24).
- **Manifest mode** is the default when no files have been touched yet.
- The injection is sent as a hidden message (`display: false`) with `customType: "mulch-prime"`.

---

## Draft lifecycle

### Generation (`maybeWriteSessionDraft` in `/src/draft.ts`)

Called from `session_shutdown` (non-reload). The function returns `null` (no draft) unless all gating conditions pass — see [Invariants](architecture.md#invariants) for the full list.

```text
maybeWriteSessionDraft(params)
  1. Check all gating conditions → return null if any fail
  2. getLatestLinterStatus(entries) → must be "clean"
  3. Filter touchedFiles to those inside gitRepoRoot
  4. Run: mulch learn --json (from gitRepoRoot for global-store drafts; from the detected project cwd for project-store fallback)
  5. buildDraftFile({ repoRoot, linterStatus, touchedFiles, lastUserPrompt, learn })
       → Creates placeholder records (one per suggestedDomain)
  6. writeDraftFile(mulchRoot, config, draft) → `.mulch/drafts/pi-mulch-draft-<timestamp>-<uuid>.json` under the selected global or project store
  7. Return file path
```

### Linter status detection (`getLatestLinterStatus`)

Scans session entries **newest-to-oldest** looking for `post-turn-linter-status` custom messages:

- `details.status === "clean"` → `"clean"`
- `details.status === "error"` → `"error"`
- Content contains "clean"/"error" → fallback string match
- Otherwise → `"findings"`
- Falls back to `post-turn-linter` entries → `"findings"`
- No match → `"unknown"`

Only `"clean"` passes the draft gate. See `/docs/tracking/post-turn-linter-clean-state-detection.md` for the full analysis.

### Draft file format

```json
{
  "version": 1,
  "createdAt": "2026-05-13T10-42-22-455Z",
  "repoRoot": "/path/to/repo",
  "linterStatus": "clean",
  "lastUserPrompt": "...",
  "touchedFiles": ["src/index.ts", ...],
  "learn": { ... },
  "records": [
    {
      "domain": "...",
      "type": "guide",
      "classification": "tactical",
      "name": "TODO: summarize learning for ...",
      "description": "TODO: replace this placeholder...",
      "files": ["src/index.ts"],
      "tags": ["draft", "pi-mulch"],
      "placeholder": true
    }
  ]
}
```

All generated records start as **placeholders** with `placeholder: true` and TODO text. They must be manually edited before apply.

### Review (`/mulch-review`)

Loads a draft file (latest if no path given), opens it in Pi's JSON editor, saves the edited result. No validation or schema checking — see `/docs/tracking/draft-quality-eager-extraction.md` risk vector #4.

### Apply (`/mulch-apply`)

Requires interactive UI. Flow:

1. Load draft file (latest or given path).
2. Open in editor for final review.
3. Save edited version.
4. Confirm via dialog.
5. `applyDraftFile()`:
   - Groups records by domain.
   - For each domain: writes a temp batch JSON file, runs `mulch record <domain> --batch <tempfile> --json`.
   - Records `appliedAt` and `applyResults` back into the draft file.
   - Temp files are cleaned up in `finally` blocks.

### Post-apply

After applying drafts, the user runs `ml sync` manually from the home directory to validate and commit `~/.mulch/` changes. This is **not** automated by the extension.

---

## Status bar states

`setStatus()` in `/src/index.ts` sets the Pi status bar:

| State | Condition |
|-------|-----------|
| `mulch: disabled` | `config.enabled === false` |
| `mulch: cli missing` | CLI not detected (`cliAvailable === false`) |
| `mulch: global init available` | CLI detected but `~/.mulch/` doesn't exist |
| `mulch: ready (N touched)` | CLI + directory present; N = touched file count |

Status is updated on: session start, every tool call, every tool result, and after init/refresh.
