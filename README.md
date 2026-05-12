# pi-mulch-integration

Pi package for Mulch-aware priming, search, status, and draft review workflows.

## What it adds

- session-start Mulch detection (`mulch` or `ml`)
- one-time repo-local prompt to run `mulch init` when `.mulch/` is missing
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

From a local checkout:

```bash
pi install git:github.com/davehardy20/pi-mulch
```

Or for one run only:

```bash
pi -e /absolute/path/to/packages/pi-mulch-integration
```

## Settings

Configure in `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "extensions": {
    "mulch": {
      "enabled": true,
      "command": null,
      "cliCandidates": ["mulch", "ml"],
      "injectionMode": "manifest",
      "primeBudget": 4000,
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
}
```

Top-level `mulch` settings are also supported.

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
4. Drafts are written to `.mulch/drafts/`.
5. You review drafts with `/mulch-review`.
6. You apply drafts with `/mulch-apply`.
7. After applying drafts to real Mulch records, run `ml sync` to
   validate and commit `.mulch/` changes.

### Important distinction

- **Automatic when enabled:** session-end draft generation into
  `.mulch/drafts/`
- **Manual review step:** `/mulch-review` and `/mulch-apply`
- **Manual persistence/sync step:** `ml sync`

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
