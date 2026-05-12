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

## Build and test

```bash
npm run typecheck
npm run test
npm run build
```
