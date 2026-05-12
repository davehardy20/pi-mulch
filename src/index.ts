/**
 * pi-mulch — Pi-native Mulch integration extension.
 *
 * Features:
 * - Detects Mulch CLI and .mulch/ on session start
 * - Offers `mulch init` once per repo/session if .mulch/ is missing
 * - Injects Mulch context in `before_agent_start` via hidden custom messages
 * - Tracks touched files for file-scoped priming
 * - Exposes LLM-callable Mulch read/query tools
 * - Generates end-of-session draft records after post-turn-linter is clean
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadMulchConfig } from "./config.js";
import { detectMulch, isMulchInstalled, isInitSuppressed } from "./detect.js";
import { runMulch } from "./exec.js";
import { createState, resetState, suppressInitForRepo } from "./state.js";
import { computePriming, markPrimingInjected, buildPrimeMessage } from "./prime.js";
import { detectTouchedFilesFromToolEvent, detectTouchedFilesFromToolResult, getTouchedFilesRelative } from "./paths.js";
import { registerMulchTools } from "./tools.js";
import { generateDrafts, listDrafts, getDraft, deleteDraft, applyDraft, markDraftApplied } from "./draft.js";
import type { PiMulchConfig, MulchDetection, MulchSessionState } from "./types.js";

export default function piMulch(pi: ExtensionAPI) {
  let detection: MulchDetection | null = null;
  let config: PiMulchConfig = loadMulchConfig(process.cwd(), null);
  let state: MulchSessionState = createState();

  const getDetection = () => detection;
  const getConfig = () => config;
  const getState = () => state;

  // Register LLM-callable tools
  registerMulchTools(
    (def: unknown) => pi.registerTool(def as Parameters<typeof pi.registerTool>[0]),
    getDetection,
    getConfig,
    getState,
  );

  // ─── session_start ───────────────────────────────────────
  pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
    const cwd = ctx.cwd ?? process.cwd();

    state = createState();
    config = loadMulchConfig(cwd, null);

    if (!config.enabled) return;

    detection = await detectMulch(cwd, config.command);

    if (!detection.cliAvailable) {
      if (ctx.hasUI) ctx.ui.setStatus("mulch", "not available");
      return;
    }

    if (ctx.hasUI) {
      ctx.ui.setStatus(
        "mulch",
        detection.mulchDirExists
          ? `${detection.cliCommand} ${detection.version} ✓`
          : `${detection.cliCommand} ${detection.version} (no .mulch/)`,
      );
    }

    // Offer mulch init if .mulch/ is missing and not suppressed
    if (!detection.mulchDirExists && !config.suppressInitPrompt) {
      const suppressed = isInitSuppressed(detection.repoRoot);
      if (!suppressed && !state.initOffered) {
        state.initOffered = true;
        setTimeout(async () => {
          if (!ctx.hasUI) return;
          const answer = await ctx.ui.select(
            "Mulch detected but no .mulch/ directory found.",
            [
              "Run mulch init",
              "Skip for now",
              "Don't ask again for this repo",
            ],
          );
          if (answer === "Run mulch init") {
            const result = await runMulch(detection!.cliCommand, ["init"], detection!.repoRoot);
            if (result.code === 0) {
              ctx.ui.notify("Mulch initialized!", "success");
              detection = await detectMulch(cwd, config.command);
              if (ctx.hasUI) ctx.ui.setStatus("mulch", `${detection?.cliCommand} ${detection?.version} ✓`);
            } else {
              ctx.ui.notify(`mulch init failed: ${result.stderr || result.stdout}`, "error");
            }
          } else if (answer === "Don't ask again for this repo") {
            suppressInitForRepo(detection!.repoRoot);
            ctx.ui.notify("Mulch init prompt suppressed for this repo.", "info");
          }
        }, 1000);
      }
    }
  });

  // ─── session_shutdown ────────────────────────────────────
  pi.on("session_shutdown", async (_event: unknown, ctx: ExtensionContext) => {
    if (detection?.mulchDirExists && state.touchedFiles.size > 0 && config.enabled) {
      if (state.lastLinterStatus === "clean" || state.lastLinterStatus === "unknown") {
        try {
          const touchedFiles = getTouchedFilesRelative(state, detection.repoRoot);
          const drafts = await generateDrafts(detection.cliCommand, touchedFiles, detection.repoRoot, config);
          if (drafts.length > 0 && ctx.hasUI) {
            ctx.ui.notify(`Generated ${drafts.length} Mulch draft(s). Use /mulch-review to inspect.`, "info");
          }
        } catch {
          // Best-effort
        }
      }
    }

    resetState(state);
    detection = null;
    if (ctx.hasUI) ctx.ui.setStatus("mulch", undefined);
  });

  // ─── before_agent_start ──────────────────────────────────
  pi.on("before_agent_start", async (_event: unknown, ctx: ExtensionContext) => {
    if (!detection?.mulchDirExists || !detection.cliAvailable || !config.enabled) return;

    const prime = await computePriming(
      detection.cliCommand,
      detection.repoRoot,
      config,
      state,
      ctx.signal,
    );
    if (!prime) return;

    markPrimingInjected(state, prime.hash);

    const messageContent = buildPrimeMessage(prime);
    pi.sendMessage({
      customType: "mulch-priming",
      content: messageContent,
      display: false,
      details: { mode: prime.mode },
    });
  });

  // ─── tool_execution_end — touched file tracking ─────────
  pi.on("tool_execution_end", async (event: { toolName?: string; args?: Record<string, unknown>; input?: Record<string, unknown>; result?: Record<string, unknown>; isError?: boolean }, _ctx: ExtensionContext) => {
    if (!detection || !config.enabled) return;
    if (event.isError) return;

    // Track from tool call args
    const filesFromEvent = detectTouchedFilesFromToolEvent(
      { toolName: event.toolName, args: event.args ?? event.input },
      detection.repoRoot,
    );
    for (const f of filesFromEvent) state.touchedFiles.add(f);

    // Track from tool result
    const filesFromResult = detectTouchedFilesFromToolResult(
      { toolName: event.toolName, result: event.result },
      detection.repoRoot,
    );
    if (filesFromResult) {
      for (const f of filesFromResult) state.touchedFiles.add(f);
    }
  });

  // ─── User commands ───────────────────────────────────────

  pi.registerCommand("mulch-init", {
    description: "Initialize Mulch in the current project",
    handler: async (_args: string | undefined, ctx: ExtensionContext) => {
      if (!detection?.cliAvailable) {
        ctx.ui.notify("Mulch CLI not found.", "error");
        return;
      }
      if (detection.mulchDirExists) {
        ctx.ui.notify("Mulch is already initialized.", "info");
        return;
      }

      const result = await runMulch(detection.cliCommand, ["init"], detection.repoRoot);
      if (result.code === 0) {
        ctx.ui.notify("Mulch initialized!", "success");
        detection = await detectMulch(ctx.cwd, config.command);
      } else {
        ctx.ui.notify(`mulch init failed: ${result.stderr || result.stdout}`, "error");
      }
    },
  });

  pi.registerCommand("mulch-prime", {
    description: "Run mulch prime and show output",
    handler: async (args: string | undefined, ctx: ExtensionContext) => {
      if (!detection?.mulchDirExists) {
        ctx.ui.notify("Mulch not available or not initialized.", "error");
        return;
      }

      const parsedArgs = (args || "").trim().split(/\s+/).filter(Boolean);
      const result = await runMulch(detection.cliCommand, ["prime", ...parsedArgs], detection.repoRoot);

      if (result.code === 0) {
        ctx.ui.notify(result.stdout || "(no output)", "info");
      } else {
        ctx.ui.notify(`mulch prime failed: ${result.stderr || result.stdout}`, "error");
      }
    },
  });

  pi.registerCommand("mulch-search", {
    description: "Search Mulch expertise records",
    handler: async (args: string | undefined, ctx: ExtensionContext) => {
      if (!detection?.mulchDirExists) {
        ctx.ui.notify("Mulch not available or not initialized.", "error");
        return;
      }

      const query = (args || "").trim();
      const cliArgs = query ? ["search", query] : ["search"];
      const result = await runMulch(detection.cliCommand, cliArgs, detection.repoRoot);

      if (result.code === 0) {
        ctx.ui.notify(result.stdout || "(no results)", "info");
      } else {
        ctx.ui.notify(`mulch search failed: ${result.stderr || result.stdout}`, "error");
      }
    },
  });

  pi.registerCommand("mulch-status", {
    description: "Show Mulch status",
    handler: async (_args: string | undefined, ctx: ExtensionContext) => {
      if (!detection?.mulchDirExists) {
        ctx.ui.notify("Mulch not available or not initialized.", "error");
        return;
      }

      const result = await runMulch(detection.cliCommand, ["status"], detection.repoRoot);
      if (result.code === 0) {
        ctx.ui.notify(result.stdout || "(no output)", "info");
      } else {
        ctx.ui.notify(`mulch status failed: ${result.stderr || result.stdout}`, "error");
      }
    },
  });

  pi.registerCommand("mulch-review", {
    description: "Review pending Mulch draft records",
    handler: async (_args: string | undefined, ctx: ExtensionContext) => {
      if (!detection?.mulchDirExists) {
        ctx.ui.notify("Mulch not available or not initialized.", "error");
        return;
      }

      const drafts = listDrafts(detection.repoRoot);
      if (drafts.length === 0) {
        ctx.ui.notify("No pending Mulch drafts.", "info");
        return;
      }

      const options = drafts.map((d) =>
        `[${d.type}] ${d.domain}: ${d.content.slice(0, 80)}${d.content.length > 80 ? "…" : ""}`,
      );

      const selectedIdx = await ctx.ui.select(
        `Mulch drafts (${drafts.length}). Select to review:`,
        options,
      );
      if (!selectedIdx) return;

      const idx = options.indexOf(selectedIdx);
      if (idx === -1) return;
      const draft = drafts[idx];

      const action = await ctx.ui.select(
        `Draft: ${draft.id}\nDomain: ${draft.domain}\nType: ${draft.type}\nContent:\n${draft.content}`,
        ["Apply this draft", "Discard this draft", "Cancel"],
      );

      if (action === "Apply this draft") {
        const result = await applyDraft(detection.cliCommand, draft, detection.repoRoot);
        if (result.success) {
          markDraftApplied(detection.repoRoot, draft.id);
          ctx.ui.notify(result.output, "success");
        } else {
          ctx.ui.notify(result.output, "error");
        }
      } else if (action === "Discard this draft") {
        deleteDraft(detection.repoRoot, draft.id);
        ctx.ui.notify("Draft discarded.", "info");
      }
    },
  });

  pi.registerCommand("mulch-apply", {
    description: "Apply a Mulch draft record (with review confirmation)",
    handler: async (args: string | undefined, ctx: ExtensionContext) => {
      if (!detection?.mulchDirExists) {
        ctx.ui.notify("Mulch not available or not initialized.", "error");
        return;
      }

      const draftId = (args || "").trim();
      if (!draftId) {
        ctx.ui.notify("Usage: /mulch-apply <draft-id>", "info");
        return;
      }

      const draft = getDraft(detection.repoRoot, draftId);
      if (!draft) {
        ctx.ui.notify(`Draft '${draftId}' not found.`, "error");
        return;
      }

      const confirmed = await ctx.ui.confirm(
        `Apply Mulch draft?`,
        `Domain: ${draft.domain}\nType: ${draft.type}\nContent:\n${draft.content}`,
      );

      if (!confirmed) {
        ctx.ui.notify("Draft apply cancelled.", "info");
        return;
      }

      const result = await applyDraft(detection.cliCommand, draft, detection.repoRoot);
      if (result.success) {
        markDraftApplied(detection.repoRoot, draft.id);
        ctx.ui.notify(result.output, "success");
      } else {
        ctx.ui.notify(result.output, "error");
      }
    },
  });
}
