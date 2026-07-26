# pi-mulch — Quickstart

<!-- markdownlint-disable MD013 MD031 -->

`@davehardy20/pi-mulch` is a **Pi extension package** (not a standalone app) that bridges the **Mulch** CLI — a project knowledge/learning tool — with the [Pi coding agent](https://github.com/earendil-works/pi-coding-agent). It automates session-level expertise loading, tracks touched files, exposes Mulch as LLM-callable tools and user commands, and generates draft learning records at session end.

**Package:** `@davehardy20/pi-mulch` v0.1.1 (`/package.json`)  
**License:** MIT  
**Runtime:** Node.js, TypeScript ESM (`"type": "module"`, target ES2022)  
**Peer dependencies:** `@earendil-works/pi-coding-agent` and `typebox` (both required)

---

## What it does

- **Detects** Mulch on session start: finds the CLI binary (`mulch` or `ml`), prefers the global `~/.mulch/` store, and keeps existing repo `.mulch/` stores as secondary scopes.
- **Primes** the agent with hidden context from global and repo-specific Mulch expertise via `before_agent_start`.
- **Tracks** files touched during a session by extracting paths from Pi tool calls and results.
- **Exposes** five LLM-callable tools (`mulch_prime`, `mulch_search`, `mulch_query`, `mulch_learn`, `mulch_status`).
- **Registers** user commands (`/mulch-init`, `/mulch-prime`, `/mulch-search`, `/mulch-query`, `/mulch-learn`, `/mulch-status`, `/mulch-review`, `/mulch-apply`, `/mulch-sync`, `/mulch-prune`, `/mulch-delete`, `/mulch-delete-domain`).
- **Generates** draft learning files under the active Mulch store (normally `~/.mulch/drafts/`) at session shutdown when the post-turn-linter reports a clean status and files were touched.

---

## Development setup

```bash
# From the repo root
npm install          # install dev + peer dependencies
npm run typecheck    # tsc --noEmit
npm run test         # vitest run
npm run build        # tsc -p tsconfig.build.json → dist/
```

All three scripts are defined in `/package.json` (`typecheck`, `test`, `test:watch`, `build`).

### Using the package in Pi

From npm:
```bash
pi install npm:@davehardy20/pi-mulch
```

From a local checkout:
```bash
pi install /absolute/path/to/pi-mulch
```

---

## Configuration

Mulch config lives in `~/.pi/agent/settings.json` under a top-level `"mulch"` key — **not** under Pi's `"extensions"` key. See [Configuration & Types](architecture.md#configuration-model) for the full field reference. If the file is missing or invalid, built-in defaults from `DEFAULT_MULCH_CONFIG` (`/src/config.ts`) are used.

Repo-local `.pi/settings.json` files are **ignored** for Mulch configuration. See `/README.md` for details.

---

## Module map

| File | Responsibility |
|------|---------------|
| `/src/index.ts` | Extension entry point: registers hooks, commands, tools. Orchestrates session lifecycle. |
| `/src/config.ts` | Config loading from global Pi settings, defaults, normalization. |
| `/src/detect.ts` | CLI binary detection, git repo root, worktree resolution. |
| `/src/exec.ts` | Runs Mulch CLI commands; formats results. |
| `/src/prime.ts` | Builds and injects Mulch prime context (manifest or file-scoped). |
| `/src/paths.ts` | Touched-file tracker and path extraction from tool events. |
| `/src/path-utils.ts` | Path normalization, repo-root confinement. |
| `/src/state.ts` | In-memory session state, repo-local init-state persistence. |
| `/src/draft.ts` | Draft file build/load/save/apply; linter-status gating. |
| `/src/tools.ts` | LLM-callable tool registration and output bounding. |
| `/src/types.ts` | Shared type definitions. |

---

## Where to go next

- **[Architecture](architecture.md)** — Config model, type system, path-safety invariants, dependency injection patterns.
- **[Workflows](workflows.md)** — Pi lifecycle hooks, detection flow, prime injection, draft generation, review/apply lifecycle.
- **[Tools & Commands](tools-and-commands.md)** — Every LLM tool and user command, their parameters, safety gates, and output bounding.
- **[Testing](testing.md)** — Test structure, DI mocking pattern, commands, common failure modes.

---

## Known issues & design docs

- `/docs/tracking/draft-quality-eager-extraction.md` — Open: risks of low-quality session-end drafts (eager domain suggestions, no significance threshold, read-only touches counted).
- `/docs/tracking/post-turn-linter-clean-state-detection.md` — Resolved: linter status detection is reliable via structured `post-turn-linter-status` session entries.

---

## Change-entrypoint summary for agents

| If you need to... | Start here |
|---|---|
| Add/modify a Pi hook handler | `/src/index.ts` — look for `pi.on(...)` blocks |
| Add a new user command | `/src/index.ts` — `pi.registerCommand(...)` block |
| Add/modify an LLM-callable tool | `/src/tools.ts` — `registerMulchTools()` |
| Change config defaults or normalization | `/src/config.ts` — `DEFAULT_MULCH_CONFIG`, `normalizeMulchConfig` |
| Change CLI detection logic | `/src/detect.ts` — `detectMulch`, `resolveCliCommand` |
| Change draft generation rules | `/src/draft.ts` — `maybeWriteSessionDraft`, `buildDraftFile`, `toBatchRecord` |
| Change path extraction or tracking | `/src/paths.ts` — `createTouchedFileTracker`, `extractPathsFrom*` |
| Change path safety / confinement | `/src/path-utils.ts` — `resolvePathInsideRoot` |
| Add/change a type definition | `/src/types.ts` |
| Understand session state lifecycle | `/src/state.ts` and `session_start` handler in `/src/index.ts` |
