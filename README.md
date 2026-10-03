# @davehardy20/pi-mulch

Pi package for Mulch-aware priming, search, status, and draft review workflows.

## What it adds

- session-start Mulch detection (`mulch` or `ml`)
- global Mulch store detection under `~/.mulch`, plus existing repo `.mulch/` as a secondary read scope
- one-time prompt to run `mulch init` for the global store when `~/.mulch/` is missing
- hidden `before_agent_start` priming via `mulch prime`
- touched-file tracking from common Pi tool activity
- LLM-callable tools:
  - `mulch_prime`
  - `mulch_search`
  - `mulch_query`
  - `mulch_learn`
  - `mulch_status`
- user commands:
  - `/mulch-init`
  - `/mulch-prime`
  - `/mulch-search`
  - `/mulch-query`
  - `/mulch-learn`
  - `/mulch-status`
  - `/mulch-review`
  - `/mulch-apply`
- session-end draft generation gated on clean post-turn-linter status

## Install

From npm:

```bash
pi install npm:@davehardy20/pi-mulch
```

For one run only:

```bash
pi -e npm:@davehardy20/pi-mulch
```

From a local checkout during development:

```bash
pi install /absolute/path/to/pi-mulch
```

## Settings

Configure in `~/.pi/agent/settings.json`:

```json
{
  "mulch": {
    "enabled": true,
    "command": null,
    "cliCandidates": ["mulch", "ml"],
    "injectionMode": "manifest",
    "primeBudget": 4000,
    "outputMaxChars": 6000,
    "promptOnMissingInit": true,
    "persistInitDecline": true,
    "draftMode": "session-end",
    "draftDir": ".mulch/drafts",
    "initStateFile": ".pi/mulch-integration.json",
    "maxTrackedFiles": 24,
    "llmTools": [
      "mulch_prime",
      "mulch_search",
      "mulch_query",
      "mulch_learn",
      "mulch_status"
    ]
  }
}
```

Use top-level `mulch` settings. Do **not** put this config under Pi's top-level
`extensions` key, because Pi reserves `extensions` for extension file paths and
package sources, not per-extension config.

If `~/.pi/agent/settings.json` is missing, invalid, or does not contain Mulch
settings, pi-mulch uses its built-in defaults. Repo-local `.pi/settings.json`
files are ignored for Mulch configuration.

Mulch read tools return bounded summaries by default (`outputMaxChars`, 6000
chars unless overridden). Re-run the same tool with `fullOutput: true` when a
complete raw result is needed.

For safety:

- `command` and `cliCandidates` are only honored from global Pi settings
- `draftDir` is confined to the active Mulch store root, which is normally `~/.mulch`
- `initStateFile` is confined to the current repo root for per-repo prompt suppression

## Draft workflow

The extension is designed to create **draft Mulch learnings at
session end**. You should not need to run `ml learn` and `ml record
...` just to get draft records created when `draftMode` is set to
`"session-end"`.

### Normal flow

1. Pi session runs with the extension enabled.
2. The extension injects Mulch context at `before_agent_start`.
3. When `draftMode` is `"session-end"`, relevant files were touched,
   and the post-turn-linter finished **cleanly**, the extension can
   generate draft records at session end.
4. Drafts are written to the active Mulch store, normally `~/.mulch/drafts/`.
5. You review drafts with `/mulch-review`.
6. You apply drafts with `/mulch-apply`.
7. After applying drafts to real Mulch records, run `/mulch-sync` to validate
   and commit changes. If `~/.mulch` links to a `.mulch` directory inside its
   own Git repository, sync runs from that repository root instead of home.
   The target must be a directory named `.mulch` with real parent `.git`
   metadata; invalid or broken links fail closed. Reads still use `~/.mulch`.
   For direct CLI use, run `ml sync` from the directory containing the real
   `.mulch` store (for example, `cd ~/tools/global-mulch && ml sync`).
   Legacy non-symlink global stores still sync from home.

### Important distinction

- **Automatic when enabled:** session-end draft generation into
  `~/.mulch/drafts/` by default
- **Manual review step:** `/mulch-review` and `/mulch-apply`
- **Manual persistence/sync step:** `/mulch-sync` (or `ml sync` from the store's repo root)
- **Existing Pi sessions:** `/reload` after changing the extension

### When to use `ml learn` and `ml record`

Use `ml learn` and `ml record ...` when you want to create or curate
Mulch records directly yourself, outside the extension's automatic
draft workflow.

## Build and test

```bash
npm run typecheck
npm run test
npm run build
```
