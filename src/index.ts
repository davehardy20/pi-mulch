/**
 * Pi-native Mulch integration extension
 *
 * - Detects Mulch CLI and .mulch/ on session start
 * - Offers mulch init once per repo/session if missing
 * - Injects Mulch context in before_agent_start via hidden custom messages
 * - Tracks touched files from relevant tool events
 * - Exposes safe Mulch read/query tools and user commands
 * - Generates end-of-session draft records after post-turn-linter is clean
 */

import type { PiMulchConfig, MulchState, MulchDetection } from "./types.js";
import { loadConfig, isInitDeclined, setInitDeclined } from "./config.js";
import { detectMulch } from "./detect.js";
import { createState } from "./state.js";
import {
  detectTouchedFilesFromToolEvent,
  detectTouchedFilesFromToolResult,
} from "./paths.js";
import {
  getManifestPrime,
  getScopedPrime,
  buildPrimeMessage,
} from "./prime.js";
import { generateDrafts } from "./draft.js";
import { registerMulchTools, registerMulchCommands } from "./tools.js";

// Minimal type stubs for the Pi extension API — the real types come from
// the pi-coding-agent package at runtime.
interface ExtensionAPI {
  on(event: string, handler: (...args: unknown[]) => void | Promise<void>): void;
  sendMessage(msg: unknown, opts?: unknown): void;
  sendUserMessage(msg: string, opts?: unknown): void;
  registerTool(tool: unknown): void;
  registerCommand(name: string, opts: unknown): void;
}

interface ExtensionContext {
  cwd: string;
  hasUI: boolean;
  signal?: AbortSignal;
  ui: {
    notify(msg: string, level: string): void;
    confirm(title: string, message: string): Promise<boolean>;
  };
  sessionManager: {
    getBranch(): unknown[];
  };
}

interface SessionStartEvent {
  reason: string;
}

interface ToolEvent {
  toolName: string;
  args?: Record<string, unknown>;
  result?: Record<string, unknown>;
}

export default function piMulchExtension(pi: ExtensionAPI) {
  let config: PiMulchConfig = loadConfig(process.cwd());
  let state: MulchState = createState();
  let detection: MulchDetection | null = null;
  let registered = false;

  function effectiveCommand(): string {
    return detection?.cliCommand ?? config.command;
  }

  async function maybeOfferInit(ctx: ExtensionContext) {
    if (!detection?.cliAvailable) return;
    if (detection.dotMulchExists) return;
    if (state.initOffered) return;
    if (state.initDeclined) return;

    state.initOffered = true;

    if (config.suppressInitPrompt) {
      const declined = isInitDeclined(ctx.cwd);
      if (declined) {
        state.initDeclined = true;
        return;
      }
    }

    if (!ctx.hasUI) return;

    const ok = await ctx.ui.confirm(
      "Initialize Mulch?",
      "No .mulch/ directory found. Run `mulch init` to set up expertise tracking?",
    );

    if (ok) {
      pi.sendUserMessage("/mulch-init", { deliverAs: "followUp" });
    } else {
      state.initDeclined = true;
      if (config.suppressInitPrompt) {
        setInitDeclined(ctx.cwd, true);
      }
    }
  }

  async function injectPrime(
    ctx: ExtensionContext,
    signal?: AbortSignal,
  ) {
    if (!detection?.cliAvailable || !detection.dotMulchExists) return;

    const command = effectiveCommand();

    let primeResult: {
      content: string;
      hash: string;
      mode: "manifest" | "scoped";
    } | null = null;

    if (!state.primedOnce) {
      // First turn: manifest priming
      primeResult = await getManifestPrime(command, ctx.cwd);
      state.primedOnce = true;
    } else if (state.touchedFiles.size > 0) {
      // Subsequent turns with touched files: file-scoped priming
      const files = Array.from(state.touchedFiles);
      state.touchedFiles.clear();

      primeResult = await getScopedPrime(
        command,
        files,
        ctx.cwd,
        config,
      );
    }

    if (!primeResult) return;

    // Deduplicate repeated injections
    if (primeResult.hash === state.lastPrimeHash) return;
    state.lastPrimeHash = primeResult.hash;

    const message = buildPrimeMessage(primeResult);

    pi.sendMessage(
      {
        customType: "pi-mulch-context",
        content: message,
        display: false,
      },
      { deliverAs: "steer" },
    );
  }

  function updateLinterStatus(ctx: ExtensionContext) {
    const branch = ctx.sessionManager.getBranch();
    // Scan backwards for the most recent post-turn-linter-status entry
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i] as Record<string, unknown> | undefined;
      if (!entry) continue;
      if (
        entry.type === "custom_message" &&
        entry.customType === "post-turn-linter-status"
      ) {
        const details = entry.details as
          | { status?: string }
          | undefined;
        if (details?.status === "clean") {
          state.lastLinterStatus = "clean";
        } else {
          state.lastLinterStatus = "dirty";
        }
        return;
      }
    }
  }

  pi.on("session_start", async (event: unknown, ctx: unknown) => {
    const e = event as SessionStartEvent;
    const c = ctx as ExtensionContext;
    config = loadConfig(c.cwd);
    state = createState();

    if (!config.enabled) return;

    detection = await detectMulch(c.cwd, config.command);
    state.initDeclined = isInitDeclined(c.cwd);

    if (detection.cliAvailable && detection.dotMulchExists) {
      if (c.hasUI) {
        c.ui.notify(
          `🌱 Mulch detected (${detection.version || detection.cliCommand})`,
          "info",
        );
      }
    }

    // Offer init if .mulch/ is missing
    if (
      e.reason === "startup" ||
      e.reason === "new" ||
      e.reason === "resume"
    ) {
      await maybeOfferInit(c);
    }

    // Register tools and commands once per session
    if (!registered) {
      registered = true;
      registerMulchTools(
        { registerTool: (tool) => pi.registerTool(tool) },
        config,
        state,
      );
      registerMulchCommands(
        {
          registerCommand: (name, opts) =>
            pi.registerCommand(name, opts),
        },
        config,
        state,
      );
    }
  });

  pi.on("before_agent_start", async (_event: unknown, ctx: unknown) => {
    if (!config.enabled) return;
    if (!detection?.cliAvailable || !detection.dotMulchExists) return;

    const c = ctx as ExtensionContext;
    await injectPrime(c, c.signal);
  });

  pi.on("tool_execution_start", async (event: unknown, ctx: unknown) => {
    if (!config.enabled) return;
    const e = event as ToolEvent;
    const c = ctx as ExtensionContext;
    const files = detectTouchedFilesFromToolEvent(
      { toolName: e.toolName, args: e.args },
      c.cwd,
    );
    for (const f of files) {
      state.touchedFiles.add(f);
    }
  });

  pi.on("tool_execution_end", async (event: unknown, ctx: unknown) => {
    if (!config.enabled) return;
    const e = event as ToolEvent;
    const c = ctx as ExtensionContext;
    const resultFiles = detectTouchedFilesFromToolResult(
      { toolName: e.toolName, result: e.result },
      c.cwd,
    );
    const files = resultFiles ??
      detectTouchedFilesFromToolEvent(
        { toolName: e.toolName, args: e.args },
        c.cwd,
      );
    for (const f of files) {
      state.touchedFiles.add(f);
    }
  });

  pi.on("turn_end", async (_event: unknown, ctx: unknown) => {
    if (!config.enabled) return;
    const c = ctx as ExtensionContext;
    updateLinterStatus(c);
  });

  pi.on("agent_end", async (_event: unknown, ctx: unknown) => {
    if (!config.enabled) return;
    if (config.draftMode === "off") return;
    if (state.draftInProgress) return;

    // Only auto-generate drafts after linter is clean
    if (state.lastLinterStatus !== "clean") return;

    const filesToDraft = Array.from(state.touchedFiles);
    if (filesToDraft.length === 0) return;

    state.touchedFiles.clear();
    state.draftInProgress = true;

    const c = ctx as ExtensionContext;

    try {
      const command = effectiveCommand();
      const drafts = await generateDrafts(
        command,
        filesToDraft,
        c.cwd,
        config,
      );
      if (drafts.length > 0 && c.hasUI) {
        c.ui.notify(
          `🌱 Generated ${drafts.length} Mulch draft(s). Run /mulch-review to see them.`,
          "info",
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (c.hasUI) {
        c.ui.notify(`Mulch draft generation failed: ${msg}`, "error");
      }
    } finally {
      state.draftInProgress = false;
      state.lastLinterStatus = "unknown";
    }
  });

  pi.on("session_shutdown", async () => {
    // No-op: drafts are already persisted to disk
    registered = false;
  });
}
