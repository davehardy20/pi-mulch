# Track: Post-turn-linter completion/clean-state detection

## Status: Resolved — signal is direct and reliable

## Original concern

> Post-turn-linter completion/clean-state detection may be nontrivial if its signal is indirect or timing-sensitive.

## Analysis

### Signal mechanism

The post-turn-linter extension emits its status via **two** `custom_message` session entries after each lint run:

1. **`post-turn-linter`** (display: true) — the findings report itself. Present only when there are findings.
2. **`post-turn-linter-status`** (display: false) — a structured status entry always emitted, with `details.status` being one of:
   - `"clean"` — no findings, all files passed
   - `"findings"` — lint issues detected
   - `"tool-error"` — a linter tool failed (e.g., biome not found, timeout)

Both are written via `pi.sendMessage()` which persists them as `custom_message` entries in the session file with `display: false` for the status entry.

### Why the signal IS reliable

1. **Explicit, structured status**: The `post-turn-linter-status` entry has a `details.status` field that is one of three known strings. No string parsing needed — the code in `draft.ts:getLatestLinterStatus()` checks `details.status` first and falls back to content parsing only as a safety net.

2. **Always emitted**: Every lint run (whether clean, findings, or error) emits exactly one status entry. There is no code path that runs linters without emitting a status. See `reportLintFindings()` in `index.ts` — all three branches (clean, findings, tool-error) call `pi.sendMessage()` with the status custom message.

3. **Sequential ordering within a turn**: Pi appends entries to the session in order. The post-turn-linter runs at `turn_end` and emits its messages before the next turn starts. When `session_shutdown` fires and calls `maybeWriteSessionDraft()`, the linter's status entries are already in the session history because:
   - `turn_end` fires → linter runs → status emitted → turn completes
   - `agent_end` fires → all turns done
   - `session_shutdown` fires → extension reads entries

4. **Latest-wins via reverse scan**: `getLatestLinterStatus()` scans entries from newest to oldest, returning the first match. This correctly handles multiple turns — if the last turn was clean, it reports clean even if earlier turns had findings.

### Actual session evidence

Confirmed from live session data (`2026-05-12T11-59-35-232Z_*.jsonl`):
```json
{
  "type": "custom_message",
  "customType": "post-turn-linter-status",
  "content": "post-turn-linter: clean (2 file(s) checked)",
  "display": false,
  "details": { "status": "clean", "files": [...] }
}
```

The entry is properly structured with `details.status: "clean"`.

### Edge cases and their handling

| Edge case | Risk | Handling |
|-----------|------|----------|
| No linter installed or configured | `unknown` status returned | `maybeWriteSessionDraft` skips draft generation — correct behavior |
| Linter runs but errors out | `tool-error` status emitted | Draft is skipped (only `"clean"` passes gate) — correct |
| Multiple turns in one prompt | Multiple status entries | Reverse scan picks the latest — correct |
| Linter takes too long | Cooldown prevents re-run, but previous status still available | Reverse scan finds last completed status — correct |
| Session shutdown before linter finishes | `turn_end` handler checks `state.runInProgress` and `state.shutDown` flags | No status emitted → `unknown` → draft skipped — correct |
| Compaction removes older entries | Status entries from compacted turns are gone | Reverse scan only sees remaining entries — correct, since we only care about the latest state |
| `post-turn-linter` extension not loaded | No status entries at all | Returns `"unknown"` → draft skipped — correct, as we can't confirm clean state |

### Timing analysis

The concern was that the signal might be "indirect or timing-sensitive." In practice:

1. **The signal is NOT indirect** — it's a dedicated `post-turn-linter-status` custom message with a structured `details.status` field. The Mulch extension does not need to infer status from the findings message content or from TUI notifications.

2. **The timing IS safe for `session_shutdown`** — but only because `turn_end` fires before `agent_end` fires before `session_shutdown`. The linter status is guaranteed to be in the session history by the time `session_shutdown` runs, UNLESS:
   - The linter is still running (in which case `runInProgress` is true and the status hasn't been emitted yet)
   - The process is force-killed (in which case shutdown handlers may not run at all)

3. **For `agent_end` timing** (the recommended alternative to `session_shutdown`): The same guarantee holds. `agent_end` fires after all turns complete, and each turn's `turn_end` has already run the linter and emitted status.

### Remaining minor risks

1. **Race on force-kill**: If the user Ctrl+C kills pi while the linter is mid-run, the `session_shutdown` handler may still fire but the status won't be in session history. This results in `"unknown"` and no draft — a safe failure mode (no false "clean" state).

2. **`getEntries()` branch awareness**: `getLatestLinterStatus()` operates on the flat entry list from `getEntries()`. In a tree-structured session, this should return the current branch entries, which is correct — we only want the status from the active conversation path.

3. **Future changes to post-turn-linter**: If the linter extension changes its `customType` or `details` schema, the draft module's detection would break silently (returning `"unknown"`). This is mitigated by:
   - Both extensions live in the same `~/.pi/agent/extensions/` tree
   - The `post-turn-linter-status` customType is stable and used consistently
   - The fallback string-content parsing provides a second chance at detection

## Conclusion

**The concern is resolved.** The post-turn-linter provides a direct, structured, always-emitted signal via `post-turn-linter-status` custom messages. The `getLatestLinterStatus()` implementation in `draft.ts` correctly consumes this signal with appropriate fallbacks and handles all identified edge cases safely. No code changes needed.

The existing test coverage (`test/draft.test.ts`) validates both the clean-gate-pass and findings-gate-block scenarios. The `"unknown"` gate-block (no linter entries) is implicitly tested by the `maybeWriteSessionDraft` test that requires explicit clean status entries to produce a draft.
