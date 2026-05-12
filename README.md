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

Create `.pi/pi-mulch.config.json` in your project root or `~/.pi/agent/pi-mulch.config.json` globally:

```json
{
  "enabled": true,
  "command": "mulch",
  "injectionMode": "manifest",
  "injectionBudget": 4000,
  "suppressInitPrompt": true,
  "draftMode": "auto",
  "autoLearnDomains": ["general"]
}
```

| Option | Description |
|--------|-------------|
| `enabled` | Enable/disable the extension |
| `command` | Mulch CLI command: `mulch`, `ml`, or custom path |
| `injectionMode` | `manifest`, `prime`, or `auto` |
| `injectionBudget` | Max estimated tokens for prime output |
| `suppressInitPrompt` | Persist decline across sessions (repo-local) |
| `draftMode` | `auto`, `manual`, or `off` |
| `autoLearnDomains` | Default domains for draft generation |

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
