# pi-mulch

Pi-native Mulch integration extension for expertise context management.

## Features

- **Auto-detection**: Detects Mulch CLI and `.mulch/` on session start
- **Init prompting**: Offers `mulch init` once per repo if `.mulch/` is missing, with repo-local decline persistence
- **Context injection**: Injects Mulch expertise into the agent via hidden custom messages using manifest-first priming and file-scoped priming
- **Touched-file tracking**: Tracks files from `read`, `write`, `edit`, `hashline_edit`, `lsp_rename`, and `ast_grep_replace`
- **LLM tools**: `mulch_prime`, `mulch_search`, `mulch_query`, `mulch_learn`, `mulch_status`
- **User commands**: `/mulch-init`, `/mulch-prime`, `/mulch-search`, `/mulch-status`, `/mulch-review`, `/mulch-apply`, `/mulch-sync`, `/mulch-prune`, `/mulch-delete`, `/mulch-delete-domain`
- **Draft workflow**: Auto-generates draft Mulch records after post-turn-linter reports clean, stored in `.mulch/drafts/` for review/apply

## Installation

As a Pi package:

```bash
pi install git:github.com/davehardy20/pi-mulch
```

Or manually clone into your Pi extensions directory:

```bash
git clone https://github.com/davehardy20/pi-mulch.git ~/.pi/agent/extensions/pi-mulch
cd ~/.pi/agent/extensions/pi-mulch
npm install
```

## Configuration

Configuration loads from three layers (later overrides earlier):

1. **Built-in defaults** — no file needed for basic usage
2. **Global settings** — `~/.pi/agent/settings.json` under a `"mulch": { ... }` key
3. **Project-local YAML** — `.mulch/mulch.config.yaml` under a `pi:` section

### Quick config (global)

Add to `~/.pi/agent/settings.json`:

```json
{
  "mulch": {
    "enabled": true,
    "command": "mulch"
  }
}
```

### Project-local config (YAML)

Create `.mulch/mulch.config.yaml` in your project root:

```yaml
pi:
  enabled: true
  injectionMode: auto
  injectionBudget: 6000
  draftMode: manual
  autoLearnDomains:
    - architecture
    - typescript
```

### Option Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable/disable the extension |
| `command` | `string` | `"mulch"` | Mulch CLI command: `mulch`, `ml`, or custom path |
| `injectionMode` | `"manifest" \| "prime" \| "auto"` | `"manifest"` | How context is injected at agent start |
| `injectionBudget` | `number` | `4000` | Max estimated tokens for prime output |
| `suppressInitPrompt` | `boolean` | `false` | Persist decline across sessions (repo-local) |
| `draftMode` | `"auto" \| "manual" \| "off"` | `"auto"` | Whether to auto-generate end-of-session drafts |
| `autoLearnDomains` | `string[]` | `[]` | Default domains for draft generation |

### injectionMode

- **`manifest`** — First turn only; runs `mulch prime --manifest`. Minimal overhead.
- **`prime`** — Full `mulch prime` every turn (deduped by content hash).
- **`auto`** — Manifest on first turn, then file-scoped priming once touched files are tracked.

### draftMode

- **`auto`** — Generates drafts at session end when linter reports clean.
- **`manual`** — No auto-generation. Use `mulch record` directly or `/mulch-review`.
- **`off`** — Disable draft workflow entirely.

### Example Configs

The [`examples/`](examples/) directory contains ready-to-use configurations:

| File | Use case |
|------|----------|
| `pi-mulch.config.minimal.json` | Just enable Mulch and go |
| `pi-mulch.config.json` | Recommended general-purpose config |
| `pi-mulch.config.full.json` | Every option with inline docs |
| `pi-mulch.config.manual-drafts.json` | No auto-drafts; review only |
| `pi-mulch.config.disabled.json` | Disable without uninstalling |
| `mulch.config.yaml` | Project-local YAML example |

See [`examples/README.md`](examples/README.md) for full details.

## Usage

### Commands

| Command | Description |
|---------|-------------|
| `/mulch-init` | Initialize Mulch for this repo |
| `/mulch-prime` | Run `mulch prime` |
| `/mulch-search <query>` | Search Mulch expertise |
| `/mulch-status` | Show Mulch status |
| `/mulch-review` | Review pending drafts |
| `/mulch-apply <draft-id>` | Apply a draft with confirmation |
| `/mulch-sync` | Sync Mulch records |
| `/mulch-prune` | Prune stale records (with confirmation) |
| `/mulch-delete <domain> <id>` | Delete a record (with confirmation) |
| `/mulch-delete-domain <domain>` | Delete a domain (with confirmation) |

### LLM Tools

The following tools are callable by the LLM:

- `mulch_prime` — Load expertise context
- `mulch_search` — Search expertise records
- `mulch_query` — Query records in a domain
- `mulch_learn` — Show changed files and suggest domains
- `mulch_status` — Show expertise health

## Development

```bash
npm install
npm run typecheck
npm test
```

## License

MIT
