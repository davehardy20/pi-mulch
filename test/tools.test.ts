/**
 * Tests for src/tools.ts — LLM-callable Mulch tools and user commands
 *
 * Tool registration is tested with a mock ExtensionAPI. Execute handlers
 * and command handlers are exercised via mocked exec/draft dependencies.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { PiMulchConfig, MulchState } from "../src/types.js";

// ── Mock exec module ────────────────────────────────────────────────────

vi.mock("../src/exec.js", () => ({
  runMulchCommand: vi.fn().mockResolvedValue({
    displayCommand: "mulch prime",
    cwd: "/tmp",
    exitCode: 0,
    timedOut: false,
    aborted: false,
    stdout: "prime output here",
    stderr: "",
  }),
  formatMulchResult: vi.fn((r: { displayCommand: string; cwd: string; exitCode: number | null; stdout: string }) =>
    [
      `Command: ${r.displayCommand}`,
      `CWD: ${r.cwd}`,
      `Exit code: ${r.exitCode}`,
      "",
      r.stdout || "(no output)",
    ].join("\n"),
  ),
}));

// ── Mock draft module ───────────────────────────────────────────────────

vi.mock("../src/draft.js", () => ({
  listDrafts: vi.fn().mockReturnValue([]),
  readDraft: vi.fn().mockReturnValue(null),
  removeDraft: vi.fn().mockReturnValue(true),
  applyDraft: vi.fn().mockResolvedValue({ success: true, output: "applied" }),
  saveDraft: vi.fn(),
  ensureDraftsDir: vi.fn(),
  getDraftsDir: vi.fn(),
  generateDraftsFromSession: vi.fn().mockResolvedValue([]),
}));

// ── Import SUT after mocks ──────────────────────────────────────────────

import { runMulchCommand } from "../src/exec.js";
import {
  listDrafts,
  registerMulchTools,
  registerMulchCommands,
} from "../src/tools.js";

// ── Fixtures ────────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<PiMulchConfig>): PiMulchConfig {
  return {
    enabled: true,
    command: "mulch",
    injectionMode: "manifest",
    injectionBudget: 4000,
    suppressInitPrompt: false,
    draftMode: "auto",
    autoLearnDomains: ["general"],
    ...overrides,
  };
}

function makeState(): MulchState {
  return {
    initOffered: false,
    initDeclined: false,
    primedOnce: false,
    lastPrimeHash: null,
    touchedFiles: new Set(),
    lastLinterStatus: "unknown",
    draftInProgress: false,
  };
}

interface CapturedTool {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: unknown;
  execute: (
    toolCallId: string,
    params: unknown,
    signal: AbortSignal,
    onUpdate: unknown,
    ctx: unknown,
  ) => Promise<unknown>;
}

interface CapturedCommand {
  name: string;
  description: string;
  handler: (args: string, ctx: unknown) => Promise<void>;
}

function makeMockPi(): {
  pi: {
    registerTool: (tool: CapturedTool) => void;
    registerCommand: (name: string, opts: { description: string; handler: (args: string, ctx: unknown) => Promise<void> }) => void;
  };
  tools: CapturedTool[];
  commands: CapturedCommand[];
} {
  const tools: CapturedTool[] = [];
  const commands: CapturedCommand[] = [];

  const pi = {
    registerTool(tool: CapturedTool) {
      tools.push(tool);
    },
    registerCommand(
      name: string,
      opts: { description: string; handler: (args: string, ctx: unknown) => Promise<void> },
    ) {
      commands.push({ name, description: opts.description, handler: opts.handler });
    },
  };

  return { pi, tools, commands };
}

function makeMockCtx(cwd: string, confirmResult = true) {
  const notifications: Array<{ msg: string; level: string }> = [];
  return {
    cwd,
    ui: {
      notify(msg: string, level: string) {
        notifications.push({ msg, level });
      },
      async confirm(_title: string, _message: string): Promise<boolean> {
        return confirmResult;
      },
    },
    notifications,
  };
}

function makeSignal(): AbortSignal {
  return new AbortController().signal;
}

async function createTempDir(withMulch = false): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-mulch-tools-"));
  if (withMulch) {
    await mkdir(join(dir, ".mulch"));
  }
  return dir;
}

function cleanup(dir: string) {
  return rm(dir, { recursive: true, force: true });
}

function getToolByName(tools: CapturedTool[], name: string): CapturedTool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

// ── Tool registration tests ─────────────────────────────────────────────

describe("registerMulchTools", () => {
  it("registers exactly 5 LLM-callable tools", () => {
    const { pi, tools } = makeMockPi();
    registerMulchTools(pi, makeConfig(), makeState());
    expect(tools).toHaveLength(5);
  });

  it("registers tools with correct names", () => {
    const { pi, tools } = makeMockPi();
    registerMulchTools(pi, makeConfig(), makeState());
    const names = tools.map((t) => t.name);
    expect(names).toContain("mulch_prime");
    expect(names).toContain("mulch_search");
    expect(names).toContain("mulch_query");
    expect(names).toContain("mulch_learn");
    expect(names).toContain("mulch_status");
  });

  it("each tool has a label, description, and promptSnippet", () => {
    const { pi, tools } = makeMockPi();
    registerMulchTools(pi, makeConfig(), makeState());
    for (const tool of tools) {
      expect(tool.label).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.promptSnippet).toBeTruthy();
    }
  });

  it("each tool has promptGuidelines", () => {
    const { pi, tools } = makeMockPi();
    registerMulchTools(pi, makeConfig(), makeState());
    for (const tool of tools) {
      expect(tool.promptGuidelines).toBeDefined();
      expect(tool.promptGuidelines!.length).toBeGreaterThan(0);
    }
  });

  it("mulch_search requires a query parameter", () => {
    const { pi, tools } = makeMockPi();
    registerMulchTools(pi, makeConfig(), makeState());
    const search = getToolByName(tools, "mulch_search");
    const schema = search.parameters as {
      type: string;
      properties: Record<string, unknown>;
      required?: string[];
    };
    expect(schema.properties.query).toBeDefined();
    expect(schema.required).toContain("query");
  });

  it("mulch_status has no required parameters", () => {
    const { pi, tools } = makeMockPi();
    registerMulchTools(pi, makeConfig(), makeState());
    const status = getToolByName(tools, "mulch_status");
    const schema = status.parameters as {
      type: string;
      properties: Record<string, unknown>;
      required?: string[];
    };
    expect(schema.required ?? []).toHaveLength(0);
  });
});

// ── Command registration tests ──────────────────────────────────────────

describe("registerMulchCommands", () => {
  it("registers all 10 commands", () => {
    const { pi, commands } = makeMockPi();
    registerMulchCommands(pi, makeConfig(), makeState());
    const names = commands.map((c) => c.name);
    expect(commands).toHaveLength(10);
    expect(names).toContain("mulch-init");
    expect(names).toContain("mulch-prime");
    expect(names).toContain("mulch-search");
    expect(names).toContain("mulch-status");
    expect(names).toContain("mulch-review");
    expect(names).toContain("mulch-apply");
    expect(names).toContain("mulch-sync");
    expect(names).toContain("mulch-prune");
    expect(names).toContain("mulch-delete");
    expect(names).toContain("mulch-delete-domain");
  });

  it("each command has a description", () => {
    const { pi, commands } = makeMockPi();
    registerMulchCommands(pi, makeConfig(), makeState());
    for (const cmd of commands) {
      expect(cmd.description).toBeTruthy();
    }
  });

  it("mulch-search notifies usage warning when no args", async () => {
    const { pi, commands } = makeMockPi();
    registerMulchCommands(pi, makeConfig(), makeState());
    const cmd = commands.find((c) => c.name === "mulch-search")!;
    const ctx = makeMockCtx("/tmp");
    await cmd.handler("", ctx);
    expect(ctx.notifications[0]).toEqual({
      msg: "Usage: /mulch-search <query>",
      level: "warning",
    });
  });

  it("mulch-apply notifies usage warning when no draft id", async () => {
    const { pi, commands } = makeMockPi();
    registerMulchCommands(pi, makeConfig(), makeState());
    const cmd = commands.find((c) => c.name === "mulch-apply")!;
    const ctx = makeMockCtx("/tmp");
    await cmd.handler("", ctx);
    expect(ctx.notifications[0]).toEqual({
      msg: "Usage: /mulch-apply <draft-id>",
      level: "warning",
    });
  });

  it("mulch-apply notifies not found for unknown draft id", async () => {
    const { pi, commands } = makeMockPi();
    registerMulchCommands(pi, makeConfig(), makeState());
    const cmd = commands.find((c) => c.name === "mulch-apply")!;
    const ctx = makeMockCtx("/tmp");
    await cmd.handler("nonexistent-id", ctx);
    expect(ctx.notifications[0]).toEqual({
      msg: "Draft nonexistent-id not found.",
      level: "error",
    });
  });

  it("mulch-delete notifies usage warning with insufficient args", async () => {
    const { pi, commands } = makeMockPi();
    registerMulchCommands(pi, makeConfig(), makeState());
    const cmd = commands.find((c) => c.name === "mulch-delete")!;
    const ctx = makeMockCtx("/tmp");
    await cmd.handler("onlydomain", ctx);
    expect(ctx.notifications[0]).toEqual({
      msg: "Usage: /mulch-delete <domain> <record-id>",
      level: "warning",
    });
  });

  it("mulch-delete-domain notifies usage warning when no domain", async () => {
    const { pi, commands } = makeMockPi();
    registerMulchCommands(pi, makeConfig(), makeState());
    const cmd = commands.find((c) => c.name === "mulch-delete-domain")!;
    const ctx = makeMockCtx("/tmp");
    await cmd.handler("", ctx);
    expect(ctx.notifications[0]).toEqual({
      msg: "Usage: /mulch-delete-domain <domain>",
      level: "warning",
    });
  });

  it("mulch-review notifies no drafts when drafts dir is empty", async () => {
    const { pi, commands } = makeMockPi();
    registerMulchCommands(pi, makeConfig(), makeState());
    const cmd = commands.find((c) => c.name === "mulch-review")!;
    const dir = await createTempDir(false);
    try {
      const ctx = makeMockCtx(dir);
      await cmd.handler("", ctx);
      expect(ctx.notifications[0].msg).toContain("No pending Mulch drafts");
    } finally {
      await cleanup(dir);
    }
  });

  it("mulch-prune cancels when user declines confirm", async () => {
    const { pi, commands } = makeMockPi();
    registerMulchCommands(pi, makeConfig(), makeState());
    const cmd = commands.find((c) => c.name === "mulch-prune")!;
    const dir = await createTempDir(false);
    try {
      const ctx = makeMockCtx(dir, false);
      await cmd.handler("", ctx);
      expect(ctx.notifications[0].msg).toContain("cancelled");
    } finally {
      await cleanup(dir);
    }
  });
});

// ── Tool execute handler tests ──────────────────────────────────────────

describe("tool execute handlers", () => {
  beforeEach(() => {
    vi.mocked(runMulchCommand).mockResolvedValue({
      displayCommand: "mulch prime",
      cwd: "/tmp",
      exitCode: 0,
      timedOut: false,
      aborted: false,
      stdout: "prime output here",
      stderr: "",
    });
  });

  function setupTools(): CapturedTool[] {
    const { pi, tools } = makeMockPi();
    registerMulchTools(pi, makeConfig(), makeState());
    return tools;
  }

  it("mulch_prime execute calls runMulchCommand with PrimeParams", async () => {
    const tools = setupTools();
    const dir = await createTempDir(false);
    try {
      const result = await getToolByName(tools, "mulch_prime").execute(
        "call-1",
        { manifest: true },
        makeSignal(),
        undefined,
        { cwd: dir },
      );
      const typed = result as {
        content: Array<{ type: string; text: string }>;
        details: Record<string, unknown>;
      };
      expect(typed.content).toHaveLength(1);
      expect(typed.content[0].type).toBe("text");
      expect(typed.content[0].text).toContain("prime output here");
      expect(typed.details.success).toBe(true);

      expect(runMulchCommand).toHaveBeenCalledWith(
        expect.objectContaining({ command: "prime", manifest: true }),
        expect.anything(),
        dir,
        { signal: expect.any(AbortSignal) },
      );
    } finally {
      await cleanup(dir);
    }
  });

  it("mulch_search execute calls runMulchCommand with SearchParams", async () => {
    const tools = setupTools();
    const dir = await createTempDir(false);
    try {
      const result = await getToolByName(tools, "mulch_search").execute(
        "call-2",
        { query: "test query", domain: "general" },
        makeSignal(),
        undefined,
        { cwd: dir },
      );
      const typed = result as {
        content: Array<{ type: string; text: string }>;
        details: Record<string, unknown>;
      };
      expect(typed.content).toHaveLength(1);
      expect(typed.details.success).toBe(true);

      expect(runMulchCommand).toHaveBeenCalledWith(
        expect.objectContaining({ command: "search", query: "test query", domain: "general" }),
        expect.anything(),
        dir,
        { signal: expect.any(AbortSignal) },
      );
    } finally {
      await cleanup(dir);
    }
  });

  it("mulch_query execute calls runMulchCommand with QueryParams", async () => {
    const tools = setupTools();
    const dir = await createTempDir(false);
    try {
      await getToolByName(tools, "mulch_query").execute(
        "call-3",
        { domain: "patterns", type: "convention" },
        makeSignal(),
        undefined,
        { cwd: dir },
      );

      expect(runMulchCommand).toHaveBeenCalledWith(
        expect.objectContaining({ command: "query", domain: "patterns", type: "convention" }),
        expect.anything(),
        dir,
        { signal: expect.any(AbortSignal) },
      );
    } finally {
      await cleanup(dir);
    }
  });

  it("mulch_learn execute calls runMulchCommand with LearnParams", async () => {
    const tools = setupTools();
    const dir = await createTempDir(false);
    try {
      await getToolByName(tools, "mulch_learn").execute(
        "call-4",
        { since: "HEAD~3" },
        makeSignal(),
        undefined,
        { cwd: dir },
      );

      expect(runMulchCommand).toHaveBeenCalledWith(
        expect.objectContaining({ command: "learn", since: "HEAD~3" }),
        expect.anything(),
        dir,
        { signal: expect.any(AbortSignal) },
      );
    } finally {
      await cleanup(dir);
    }
  });

  it("mulch_status execute calls runMulchCommand with StatusParams", async () => {
    const tools = setupTools();
    const dir = await createTempDir(false);
    try {
      const result = await getToolByName(tools, "mulch_status").execute(
        "call-5",
        {},
        makeSignal(),
        undefined,
        { cwd: dir },
      );
      const typed = result as {
        content: Array<{ type: string; text: string }>;
        details: Record<string, unknown>;
      };
      expect(typed.details.success).toBe(true);

      expect(runMulchCommand).toHaveBeenCalledWith(
        { command: "status" },
        expect.anything(),
        dir,
        { signal: expect.any(AbortSignal) },
      );
    } finally {
      await cleanup(dir);
    }
  });

  it("returns error details when command fails", async () => {
    vi.mocked(runMulchCommand).mockResolvedValueOnce({
      displayCommand: "mulch status",
      cwd: "/tmp",
      exitCode: 1,
      timedOut: false,
      aborted: false,
      stdout: "",
      stderr: "error: .mulch not found",
    });

    const tools = setupTools();
    const result = await getToolByName(tools, "mulch_status").execute(
      "call-6",
      {},
      makeSignal(),
      undefined,
      { cwd: "/tmp" },
    );
    const typed = result as {
      details: Record<string, unknown>;
    };
    expect(typed.details.success).toBe(false);
    expect(typed.details.exitCode).toBe(1);
  });

  it("returns timeout details when command times out", async () => {
    vi.mocked(runMulchCommand).mockResolvedValueOnce({
      displayCommand: "mulch prime",
      cwd: "/tmp",
      exitCode: null,
      timedOut: true,
      aborted: false,
      stdout: "",
      stderr: "",
    });

    const tools = setupTools();
    const result = await getToolByName(tools, "mulch_prime").execute(
      "call-7",
      {},
      makeSignal(),
      undefined,
      { cwd: "/tmp" },
    );
    const typed = result as {
      details: Record<string, unknown>;
    };
    expect(typed.details.timedOut).toBe(true);
    expect(typed.details.success).toBe(false);
  });

  it("returns aborted details when command is aborted", async () => {
    vi.mocked(runMulchCommand).mockResolvedValueOnce({
      displayCommand: "mulch search test",
      cwd: "/tmp",
      exitCode: null,
      timedOut: false,
      aborted: true,
      stdout: "",
      stderr: "",
    });

    const tools = setupTools();
    const result = await getToolByName(tools, "mulch_search").execute(
      "call-8",
      { query: "test" },
      makeSignal(),
      undefined,
      { cwd: "/tmp" },
    );
    const typed = result as {
      details: Record<string, unknown>;
    };
    expect(typed.details.aborted).toBe(true);
    expect(typed.details.success).toBe(false);
  });
});
