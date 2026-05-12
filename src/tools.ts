/**
 * LLM-callable tools and user commands for the pi-mulch extension.
 *
 * Five read-only tools are exposed to the LLM:
 *   - mulch_prime   (load expertise context)
 *   - mulch_search  (BM25 search across domains)
 *   - mulch_query   (browse records in a domain)
 *   - mulch_learn   (suggest domains for learnings)
 *   - mulch_status  (expertise health / coverage)
 *
 * User commands cover interactive operations including draft
 * review/apply and destructive maintenance commands.
 *
 * All tools delegate to `runMulchCommand` from exec.ts, which builds
 * validated argv arrays (no shell interpolation).  Write-capable
 * commands require `allowWrite: true`.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import {
  runMulchCommand,
  formatMulchResult,
  type MulchExecResult,
  type PrimeParams,
  type SearchParams,
  type QueryParams,
  type LearnParams,
  type StatusParams,
  type SyncParams,
  type PruneParams,
  type DeleteParams,
  type DeleteDomainParams,
} from "./exec.js";
import {
  listDrafts,
  readDraft,
  removeDraft,
} from "./draft.js";
import type { MulchState, PiMulchConfig, DraftRecord } from "./types.js";

// ── Helpers ─────────────────────────────────────────────────────────────

/** Build a tool result from a MulchExecResult. */
function toToolContent(result: MulchExecResult): {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
} {
  const success =
    !result.timedOut && !result.aborted && (result.exitCode ?? 1) === 0;
  return {
    content: [{ type: "text", text: formatMulchResult(result) }],
    details: {
      displayCommand: result.displayCommand,
      cwd: result.cwd,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      aborted: result.aborted,
      success,
    },
  };
}

/** Format a draft for display in user-facing messages. */
function formatDraftDisplay(draft: DraftRecord): string {
  return [
    `ID: ${draft.id}`,
    `Domain: ${draft.domain}`,
    `Type: ${draft.type}`,
    draft.content ? `Content: ${draft.content}` : "",
    draft.filePath ? `File: ${draft.filePath}` : "",
    `Created: ${new Date(draft.createdAt).toISOString()}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ── LLM-callable tools ─────────────────────────────────────────────────

/**
 * Register the five read-only Mulch tools with the Pi ExtensionAPI.
 *
 * These tools are safe for LLM invocation — they only read/query
 * the Mulch expertise database and never modify records.
 */
export function registerMulchTools(
  pi: ExtensionAPI,
  config: PiMulchConfig,
  _state: MulchState,
): void {
  // ── mulch_prime ────────────────────────────────────────────────────

  pi.registerTool({
    name: "mulch_prime",
    label: "Mulch Prime",
    description:
      "Load Mulch expertise context for the current project. Can scope to specific files or request manifest-only output.",
    promptSnippet: "Load relevant Mulch expertise context into the session.",
    promptGuidelines: [
      "Use mulch_prime at the start of a task to load project expertise.",
      "Pass files to scope the prime to specific paths for narrower context.",
    ],
    parameters: Type.Object({
      files: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Workspace-relative file paths to scope the prime. Omit for full or manifest prime.",
        }),
      ),
      manifest: Type.Optional(
        Type.Boolean({
          description:
            "Request manifest-only output (domain list / summary). Defaults to false.",
        }),
      ),
      budget: Type.Optional(
        Type.Number({
          description:
            "Token budget for the prime output (100–100 000). Defaults to project config.",
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: { files?: string[]; manifest?: boolean; budget?: number },
      signal: AbortSignal,
      _onUpdate: unknown,
      ctx: { cwd: string },
    ) {
      const primeParams: PrimeParams = {
        command: "prime",
        manifest: params.manifest,
        files: params.files,
        budget: params.budget,
      };

      const result = await runMulchCommand(primeParams, config, ctx.cwd, {
        signal,
      });
      return toToolContent(result);
    },
  });

  // ── mulch_search ───────────────────────────────────────────────────

  pi.registerTool({
    name: "mulch_search",
    label: "Mulch Search",
    description:
      "Search Mulch expertise records across domains using BM25 ranking. Returns matching records sorted by relevance.",
    promptSnippet: "Search the project's Mulch expertise database.",
    promptGuidelines: [
      "Use mulch_search to find relevant patterns, conventions, or decisions.",
      "Prefer specific queries over broad ones for better relevance.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query string" }),
      domain: Type.Optional(
        Type.String({ description: "Limit search to a specific domain" }),
      ),
      type: Type.Optional(
        Type.String({
          description:
            "Filter by record type: convention, pattern, failure, decision, reference, guide",
        }),
      ),
      format: Type.Optional(
        Type.String({
          description: "Output format: markdown, compact, xml, plain, ids",
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: {
        query: string;
        domain?: string;
        type?: string;
        format?: string;
      },
      signal: AbortSignal,
      _onUpdate: unknown,
      ctx: { cwd: string },
    ) {
      const searchParams: SearchParams = {
        command: "search",
        query: params.query,
        domain: params.domain,
        type: params.type as SearchParams["type"],
        format: params.format as SearchParams["format"],
      };

      const result = await runMulchCommand(searchParams, config, ctx.cwd, {
        signal,
      });
      return toToolContent(result);
    },
  });

  // ── mulch_query ────────────────────────────────────────────────────

  pi.registerTool({
    name: "mulch_query",
    label: "Mulch Query",
    description:
      "Query all records in a Mulch domain with optional type and file filtering.",
    promptSnippet: "List expertise records in a specific Mulch domain.",
    promptGuidelines: [
      "Use mulch_query to browse all records in a known domain.",
      "Combine with type filter to narrow results.",
    ],
    parameters: Type.Object({
      domain: Type.Optional(
        Type.String({
          description: "Domain to query. Omit to list all domains.",
        }),
      ),
      type: Type.Optional(
        Type.String({
          description:
            "Filter by record type: convention, pattern, failure, decision, reference, guide",
        }),
      ),
      file: Type.Optional(
        Type.String({
          description: "Filter to records referencing this file path.",
        }),
      ),
      format: Type.Optional(
        Type.String({
          description: "Output format: markdown, compact, xml, plain, ids",
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: {
        domain?: string;
        type?: string;
        file?: string;
        format?: string;
      },
      signal: AbortSignal,
      _onUpdate: unknown,
      ctx: { cwd: string },
    ) {
      const queryParams: QueryParams = {
        command: "query",
        domain: params.domain,
        type: params.type as QueryParams["type"],
        file: params.file,
        format: params.format as QueryParams["format"],
      };

      const result = await runMulchCommand(queryParams, config, ctx.cwd, {
        signal,
      });
      return toToolContent(result);
    },
  });

  // ── mulch_learn ────────────────────────────────────────────────────

  pi.registerTool({
    name: "mulch_learn",
    label: "Mulch Learn",
    description:
      "Show changed files and suggest domains for recording learnings based on recent changes.",
    promptSnippet:
      "Check what has changed and suggest where to record expertise.",
    promptGuidelines: [
      "Use mulch_learn after completing changes to identify learning opportunities.",
      "Review suggested domains before deciding whether to record new expertise.",
    ],
    parameters: Type.Object({
      since: Type.Optional(
        Type.String({
          description: "Git ref to diff against. Defaults to HEAD~1.",
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: { since?: string },
      signal: AbortSignal,
      _onUpdate: unknown,
      ctx: { cwd: string },
    ) {
      const learnParams: LearnParams = {
        command: "learn",
        since: params.since,
      };

      const result = await runMulchCommand(learnParams, config, ctx.cwd, {
        signal,
      });
      return toToolContent(result);
    },
  });

  // ── mulch_status ───────────────────────────────────────────────────

  pi.registerTool({
    name: "mulch_status",
    label: "Mulch Status",
    description:
      "Show status of the Mulch expertise database: domain counts, health, and coverage summary.",
    promptSnippet:
      "Check the health and coverage of the project's Mulch expertise.",
    promptGuidelines: [
      "Use mulch_status to assess whether expertise coverage is adequate.",
      "Call mulch_status before and after major changes to track coverage.",
    ],
    parameters: Type.Object({}),
    async execute(
      _toolCallId: string,
      _params: Record<string, never>,
      signal: AbortSignal,
      _onUpdate: unknown,
      ctx: { cwd: string },
    ) {
      const statusParams: StatusParams = { command: "status" };

      const result = await runMulchCommand(statusParams, config, ctx.cwd, {
        signal,
      });
      return toToolContent(result);
    },
  });
}

// ── User commands ───────────────────────────────────────────────────────

/**
 * Register all Mulch user commands with the Pi ExtensionAPI.
 *
 * Includes both safe read commands and destructive write commands.
 * Destructive commands (prune, delete, delete-domain) require user
 * confirmation before proceeding.
 */
export function registerMulchCommands(
  pi: ExtensionAPI,
  config: PiMulchConfig,
  state: MulchState,
  onInit?: () => Promise<void>,
): void {
  // ── /mulch-init ────────────────────────────────────────────────────

  pi.registerCommand("mulch-init", {
    description: "Initialize Mulch for this repository",
    handler: async (
      _args: string,
      ctx: {
        cwd: string;
        ui: { notify: (msg: string, level: string) => void };
      },
    ) => {
      const result = await runMulchCommand(
        { command: "sync" } as SyncParams,
        config,
        ctx.cwd,
        { allowWrite: true },
      );
      const success =
        !result.timedOut && !result.aborted && (result.exitCode ?? 1) === 0;

      if (success) {
        ctx.ui.notify("🌱 Mulch initialized successfully.", "success");
        state.initOffered = true;
        await onInit?.();
      } else {
        ctx.ui.notify(
          `Mulch init failed: ${result.stderr || result.stdout || "unknown error"}`,
          "error",
        );
      }
    },
  });

  // ── /mulch-prime ───────────────────────────────────────────────────

  pi.registerCommand("mulch-prime", {
    description: "Run mulch prime and display the output",
    handler: async (
      args: string,
      ctx: {
        cwd: string;
        ui: { notify: (msg: string, level: string) => void };
      },
    ) => {
      const params: PrimeParams = {
        command: "prime",
        format: "compact",
      };

      const tokens = (args || "").trim().split(/\s+/).filter(Boolean);
      for (const token of tokens) {
        if (token === "--manifest") params.manifest = true;
      }

      const result = await runMulchCommand(params, config, ctx.cwd);
      ctx.ui.notify(
        formatMulchResult(result),
        (result.exitCode ?? 1) === 0 ? "info" : "error",
      );
    },
  });

  // ── /mulch-search ──────────────────────────────────────────────────

  pi.registerCommand("mulch-search", {
    description: "Search Mulch expertise. Usage: /mulch-search <query>",
    handler: async (
      args: string,
      ctx: {
        cwd: string;
        ui: { notify: (msg: string, level: string) => void };
      },
    ) => {
      const query = (args || "").trim();
      if (!query) {
        ctx.ui.notify("Usage: /mulch-search <query>", "warning");
        return;
      }

      const result = await runMulchCommand(
        { command: "search", query } as SearchParams,
        config,
        ctx.cwd,
      );
      ctx.ui.notify(
        formatMulchResult(result),
        (result.exitCode ?? 1) === 0 ? "info" : "error",
      );
    },
  });

  // ── /mulch-status ──────────────────────────────────────────────────

  pi.registerCommand("mulch-status", {
    description: "Show Mulch expertise status",
    handler: async (
      _args: string,
      ctx: {
        cwd: string;
        ui: { notify: (msg: string, level: string) => void };
      },
    ) => {
      const result = await runMulchCommand(
        { command: "status" } as StatusParams,
        config,
        ctx.cwd,
      );
      ctx.ui.notify(
        formatMulchResult(result),
        (result.exitCode ?? 1) === 0 ? "info" : "error",
      );
    },
  });

  // ── /mulch-review ──────────────────────────────────────────────────

  pi.registerCommand("mulch-review", {
    description: "Review pending Mulch draft records",
    handler: async (
      _args: string,
      ctx: {
        cwd: string;
        ui: { notify: (msg: string, level: string) => void };
      },
    ) => {
      const drafts = listDrafts(ctx.cwd);
      if (drafts.length === 0) {
        ctx.ui.notify("No pending Mulch drafts.", "info");
        return;
      }
      const text = drafts.map(formatDraftDisplay).join("\n\n---\n\n");
      ctx.ui.notify(`Pending drafts:\n\n${text}`, "info");
    },
  });

  // ── /mulch-apply ───────────────────────────────────────────────────

  pi.registerCommand("mulch-apply", {
    description: "Apply a pending Mulch draft. Usage: /mulch-apply <draft-id>",
    handler: async (
      args: string,
      ctx: {
        cwd: string;
        ui: {
          notify: (msg: string, level: string) => void;
          confirm: (title: string, message: string) => Promise<boolean>;
        };
      },
    ) => {
      const draftId = (args || "").trim();
      if (!draftId) {
        ctx.ui.notify("Usage: /mulch-apply <draft-id>", "warning");
        return;
      }

      const draft = readDraft(ctx.cwd, draftId);
      if (!draft) {
        ctx.ui.notify(`Draft ${draftId} not found.`, "error");
        return;
      }

      const ok = await ctx.ui.confirm(
        "Apply Mulch Draft",
        `Apply draft for domain "${draft.domain}"?\n\n${formatDraftDisplay(draft)}`,
      );
      if (!ok) {
        ctx.ui.notify("Apply cancelled.", "info");
        return;
      }

      const result = await runMulchCommand(
        {
          command: "sync",
          message: `Apply draft ${draftId}: ${draft.domain}`,
        } as SyncParams,
        config,
        ctx.cwd,
        { allowWrite: true },
      );

      const success =
        !result.timedOut && !result.aborted && (result.exitCode ?? 1) === 0;
      if (success) {
        removeDraft(ctx.cwd, draftId);
        ctx.ui.notify("🌱 Draft applied successfully.", "success");
      } else {
        ctx.ui.notify(
          `Apply failed: ${result.stderr || result.stdout}`,
          "error",
        );
      }
    },
  });

  // ── User-only destructive commands ────────────────────────────────

  pi.registerCommand("mulch-sync", {
    description: "Sync Mulch expertise records with remote sources",
    handler: async (
      _args: string,
      ctx: {
        cwd: string;
        ui: { notify: (msg: string, level: string) => void };
      },
    ) => {
      const result = await runMulchCommand(
        { command: "sync" } as SyncParams,
        config,
        ctx.cwd,
        { allowWrite: true },
      );
      ctx.ui.notify(
        formatMulchResult(result),
        (result.exitCode ?? 1) === 0 ? "info" : "error",
      );
    },
  });

  pi.registerCommand("mulch-prune", {
    description: "Prune stale or low-quality Mulch records",
    handler: async (
      _args: string,
      ctx: {
        cwd: string;
        ui: {
          notify: (msg: string, level: string) => void;
          confirm: (title: string, message: string) => Promise<boolean>;
        };
      },
    ) => {
      const ok = await ctx.ui.confirm(
        "Prune Mulch Records",
        "This will remove stale or low-quality records. Continue?",
      );
      if (!ok) {
        ctx.ui.notify("Prune cancelled.", "info");
        return;
      }

      const result = await runMulchCommand(
        { command: "prune" } as PruneParams,
        config,
        ctx.cwd,
        { allowWrite: true },
      );
      ctx.ui.notify(
        formatMulchResult(result),
        (result.exitCode ?? 1) === 0 ? "info" : "error",
      );
    },
  });

  pi.registerCommand("mulch-delete", {
    description:
      "Delete a Mulch record. Usage: /mulch-delete <domain> <record-id>",
    handler: async (
      args: string,
      ctx: {
        cwd: string;
        ui: {
          notify: (msg: string, level: string) => void;
          confirm: (title: string, message: string) => Promise<boolean>;
        };
      },
    ) => {
      const parts = (args || "").trim().split(/\s+/);
      if (parts.length < 2) {
        ctx.ui.notify(
          "Usage: /mulch-delete <domain> <record-id>",
          "warning",
        );
        return;
      }
      const [domain, recordId] = parts;

      const ok = await ctx.ui.confirm(
        "Delete Mulch Record",
        `Delete record ${recordId} from domain "${domain}"?`,
      );
      if (!ok) {
        ctx.ui.notify("Delete cancelled.", "info");
        return;
      }

      const result = await runMulchCommand(
        {
          command: "delete",
          domain,
          records: [recordId],
        } as DeleteParams,
        config,
        ctx.cwd,
        { allowWrite: true },
      );
      ctx.ui.notify(
        formatMulchResult(result),
        (result.exitCode ?? 1) === 0 ? "info" : "error",
      );
    },
  });

  pi.registerCommand("mulch-delete-domain", {
    description:
      "Delete an entire Mulch domain. Usage: /mulch-delete-domain <domain>",
    handler: async (
      args: string,
      ctx: {
        cwd: string;
        ui: {
          notify: (msg: string, level: string) => void;
          confirm: (title: string, message: string) => Promise<boolean>;
        };
      },
    ) => {
      const domain = (args || "").trim();
      if (!domain) {
        ctx.ui.notify("Usage: /mulch-delete-domain <domain>", "warning");
        return;
      }

      const ok = await ctx.ui.confirm(
        "Delete Mulch Domain",
        `Delete entire domain "${domain}"? This cannot be undone.`,
      );
      if (!ok) {
        ctx.ui.notify("Delete cancelled.", "info");
        return;
      }

      const result = await runMulchCommand(
        { command: "delete-domain", domain } as DeleteDomainParams,
        config,
        ctx.cwd,
        { allowWrite: true },
      );
      ctx.ui.notify(
        formatMulchResult(result),
        (result.exitCode ?? 1) === 0 ? "info" : "error",
      );
    },
  });
}
