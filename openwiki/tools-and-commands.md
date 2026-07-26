# Tools & Commands

<!-- markdownlint-disable MD013 MD022 MD031 MD032 -->

pi-mulch exposes two categories of Mulch operations: **LLM-callable tools** (registered via `pi.registerTool`, available to the agent) and **user commands** (registered via `pi.registerCommand`, invoked by the user).

All tool/command registration happens in `/src/index.ts` and `/src/tools.ts`.

---

## LLM-callable tools

Registered by `registerMulchTools()` in `/src/tools.ts`. Only tools listed in `config.llmTools` are registered — the others are skipped at startup.

### `mulch_prime`
**Purpose:** Load Mulch expertise context (manifest or file-scoped).  
**Parameters:**
- `files?: string[]` — If provided, uses file-scoped prime; otherwise uses touched files, falling back to manifest mode.
- `budget?: number` — Overrides `config.primeBudget` for this call (minimum 1).
- `fullOutput?: boolean` — Return full raw output instead of bounded summary.

**CLI invocation:** `mulch prime --files <files> --budget <N> --format plain` or `mulch prime --manifest --budget <N> --format plain` against each detected memory scope.  
**Gating:** Requires `detection.ready` (CLI + global `~/.mulch/` or existing project `.mulch/`).

### `mulch_search`
**Purpose:** Search Mulch records by query string.  
**Parameters:**
- `query: string` (required, minLength 1)
- `domain?: string`
- `file?: string`
- `type?: string`
- `fullOutput?: boolean`

**CLI invocation:** `mulch search <query> [--domain D] [--file F] [--type T] --json` against each detected memory scope.  
**Gating:** Requires `detection.ready`.

### `mulch_query`
**Purpose:** Inspect records for one domain or all domains.  
**Parameters:**
- `domain?: string`
- `file?: string`
- `type?: string`
- `all?: boolean`
- `fullOutput?: boolean`

**CLI invocation:** `mulch query <domain> [--file F] [--type T] --json` or `mulch query --all --json` against each detected memory scope.  
**Gating:** Requires `detection.ready`.

### `mulch_learn`
**Purpose:** Show changed files and domain suggestions for learnings.  
**Parameters:**
- `fullOutput?: boolean`

**CLI invocation:** `mulch learn --json` once from the detected Git repository root. Learning analyzes repository changes rather than individual memory stores.  
**Gating:** Requires `detection.ready`.

### `mulch_status`
**Purpose:** Show Mulch repository readiness and domain status.  
**Parameters:**
- `fullOutput?: boolean`

**CLI invocation:** `mulch status --json` for each detected memory scope or `mulch --version` if none exist.  
**Gating:** Requires only `detection.cliAvailable` — works even without `~/.mulch/` initialized, showing detection info.

---

## Output bounding

All LLM tools use `boundMulchOutput()` in `/src/tools.ts` to cap output at `config.outputMaxChars` (default 6000 chars).

- If output is under the limit: returned as-is.
- If over: the text is split **65% head / 35% tail** with a truncation marker inserted between:
  ```text
  … Mulch output truncated from N to M chars. Re-run with fullOutput=true for the complete output. …
  ```
- Setting `fullOutput: true` on any tool bypasses truncation and returns the complete raw output.

Tool results include `details` with:
- `outputTruncated: boolean`
- `outputChars: number` (raw length)
- `outputMaxChars: number | null`
- `recovery: string` — guidance message when truncated, e.g. `"Re-run the same Mulch tool with fullOutput=true, or run: <command>"`

---

## User commands

All registered via `pi.registerCommand()` in `/src/index.ts`. Commands are **not** callable by the LLM — they require explicit user invocation (`/<command>`).

### Non-destructive commands

| Command | Behavior |
|---------|----------|
| `/mulch-init` | Runs `mulch init` for global `~/.mulch/` with confirmation dialog. Refreshes detection after success. |
| `/mulch-prime` | Runs scoped prime across global and repo-specific memories and renders output visibly (unlike the hidden `before_agent_start` injection). |
| `/mulch-search <query>` | Runs `mulch search <query>` against all detected memory scopes. Shows usage if query is empty. |
| `/mulch-query [domain]` | Runs `mulch query <domain>` or `mulch query --all` against all detected memory scopes. |
| `/mulch-learn` | Runs `mulch learn` once from the detected Git repository root. |
| `/mulch-status` | Shows detection JSON if no Mulch store exists; otherwise runs `mulch status` against all detected memory scopes. |
| `/mulch-review [path]` | Opens the latest draft (or given path) in Pi's JSON editor for editing. Saves on completion. |

### Review & apply commands

| Command | Behavior |
|---------|----------|
| `/mulch-apply [path]` | **Requires interactive UI.** Opens draft in editor → saves → confirms → applies via `mulch record --batch`. Reports per-domain apply counts. |

`/mulch-apply` applies only non-placeholder records (those with `placeholder: false` or absent). Placeholder records are silently skipped by `toBatchRecord()`.

### Destructive commands (user-only, NOT LLM-callable)

These are mutating operations. They are registered as user commands only and require `detection.ready`. Some require interactive confirmation.

| Command | Confirmation | CLI invocation |
|---------|-------------|----------------|
| `/mulch-sync [args]` | No | `mulch sync [args]` |
| `/mulch-prune [args]` | No | `mulch prune [args]` |
| `/mulch-delete <domain> [id]` | Yes (if UI) | `mulch delete <domain> [id]` |
| `/mulch-delete-domain <domain>` | Yes (if UI) | `mulch delete-domain <domain>` |

Commands that accept `[args]` pass them through `splitCliArgs()` — a simple whitespace splitter with no quoting support (see `/src/index.ts` line ~632).

---

## Common failure modes

| Scenario | Result | Source |
|----------|--------|--------|
| Mulch CLI not installed/not on PATH | All tools return error; commands show "Mulch CLI is not available." | `detect.ts:resolveCliCommand` returns `null` |
| `~/.mulch/` missing | Tools requiring `ready` return error unless an existing project `.mulch/` is available; `/mulch-status` shows detection JSON; global init prompt offered at session start | `detect.ts`, `index.ts:maybeOfferInit` |
| `mulch` command exceeds 2 MB stdout | `runMulchCommand` fails with exit code 1; stderr contains buffer error | `exec.ts:maxBuffer` |
| Global settings file invalid JSON | Config falls back to all defaults silently | `config.ts:readSettingsFile` try/catch |
| Draft apply when no non-placeholder records | 0 records applied; message shows "No actionable records." | `draft.ts:toBatchRecord` returns `null` for all placeholders |
| `/mulch-apply` without interactive UI | Aborts with message requiring interactive UI | `index.ts:commandApply` checks `ctx.hasUI` |
| Post-turn-linter status is "findings" or "error" or "unknown" | No session-end draft generated | `draft.ts:maybeWriteSessionDraft` gating |
| Session touches 0 files | No session-end draft generated | `draft.ts:maybeWriteSessionDraft` gating |

---

## Safe-edit guidance

- **Adding a new LLM tool:** Add the name to `MulchCallableToolName` (`/src/types.ts`), add a registration block in `registerMulchTools` (`/src/tools.ts`) gated by `enabled.has("your_tool")`, add to the filter list in `normalizeMulchConfig` (`/src/config.ts`), add to default `llmTools`. Add a test in `/test/tools.test.ts`.
- **Adding a new user command:** Add a `pi.registerCommand(...)` block in `/src/index.ts`. If it's destructive, gate on `ctx.hasUI` + `ctx.ui.confirm()`.
- **Changing output bounding:** Edit `boundMulchOutput()` in `/src/tools.ts`. The head/tail split ratio (65/35) is hardcoded.
- **Changing a CLI invocation:** Most CLI args are constructed inline in `/src/tools.ts` (for tools) or `/src/index.ts` (for commands). The `mulch record --batch` format is constructed in `applyDraftFile()` (`/src/draft.ts`).
