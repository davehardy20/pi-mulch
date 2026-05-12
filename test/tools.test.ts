import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { DEFAULT_MULCH_CONFIG } from "../src/config.js";
import { registerMulchTools } from "../src/tools.js";

interface RegisteredTool {
  name: string;
  execute: (...args: unknown[]) => Promise<unknown>;
}

function createMockPi() {
  const tools = new Map<string, RegisteredTool>();
  const pi = {
    registerTool: (tool: RegisteredTool) => tools.set(tool.name, tool),
  } as unknown as ExtensionAPI;
  return { pi, tools };
}

const READY_DETECTION = {
  cliAvailable: true,
  cliCommand: "mulch",
  directoryExists: true,
  directoryPath: "/repo/.mulch",
  isWorktree: false,
  mainWorktreeRoot: null,
  isGitRepo: true,
  gitRepoRoot: "/repo",
  commandCwd: "/repo",
  ready: true,
} as const;

describe("registerMulchTools", () => {
  it("registers llm-callable mulch tools and formats results", async () => {
    const { pi, tools } = createMockPi();
    registerMulchTools(
      pi,
      {
        getConfig: () => DEFAULT_MULCH_CONFIG,
        getDetection: () => ({ ...READY_DETECTION }),
        getTouchedFiles: () => ["/repo/src/index.ts"],
      },
      async (options) => ({
        command: options.command as string,
        args: options.args,
        cwd: options.cwd,
        exitCode: 0,
        stdout: '{"success":true}',
        stderr: "",
        ok: true,
        json: { success: true },
      }),
    );

    expect(Array.from(tools.keys()).sort()).toEqual([
      "mulch_learn",
      "mulch_prime",
      "mulch_query",
      "mulch_search",
      "mulch_status",
    ]);

    const result = (await tools
      .get("mulch_search")
      ?.execute("tool-1", { query: "search term" }, undefined, undefined, {
        cwd: "/repo",
      })) as {
      details: Record<string, unknown>;
      content: Array<{ text: string }>;
    };

    expect(result.details.success).toBe(true);
    expect(result.content[0]?.text).toContain('"success": true');
  });

  it("mulch_search forwards domain, file, and type params", async () => {
    const { pi, tools } = createMockPi();
    let capturedArgs: string[] = [];

    registerMulchTools(
      pi,
      {
        getConfig: () => DEFAULT_MULCH_CONFIG,
        getDetection: () => ({
          ...READY_DETECTION,
          cliCommand: "ml",
        }),
        getTouchedFiles: () => [],
      },
      async (options) => {
        capturedArgs = options.args;
        return {
          command: options.command as string,
          args: options.args,
          cwd: options.cwd,
          exitCode: 0,
          stdout: "{}",
          stderr: "",
          ok: true,
          json: {},
        };
      },
    );

    const tool = tools.get("mulch_search");
    expect(tool).toBeDefined();

    await tool?.execute(
      "tool-2",
      {
        query: "hooks",
        domain: "core",
        file: "src/index.ts",
        type: "pattern",
      },
      undefined,
      undefined,
      { cwd: "/repo" },
    );

    expect(capturedArgs).toEqual([
      "search",
      "hooks",
      "--domain",
      "core",
      "--file",
      "src/index.ts",
      "--type",
      "pattern",
    ]);
  });

  it("mulch_search returns error result when Mulch is not ready", async () => {
    const { pi, tools } = createMockPi();

    registerMulchTools(
      pi,
      {
        getConfig: () => DEFAULT_MULCH_CONFIG,
        getDetection: () => ({
          ...READY_DETECTION,
          directoryExists: false,
          ready: false,
        }),
        getTouchedFiles: () => [],
      },
      async () => ({
        command: "mulch",
        args: [],
        cwd: "/repo",
        exitCode: 0,
        stdout: "",
        stderr: "",
        ok: true,
      }),
    );

    const tool = tools.get("mulch_search");
    expect(tool).toBeDefined();

    const result = (await tool?.execute(
      "tool-3",
      { query: "test" },
      undefined,
      undefined,
      {
        cwd: "/repo",
      },
    )) as {
      isError: boolean;
      content: Array<{ text: string }>;
      details: Record<string, unknown>;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      "Mulch is not ready in this repository.",
    );
    expect(result.details.success).toBe(false);
  });

  it("returns error result when detection is null", async () => {
    const { pi, tools } = createMockPi();

    registerMulchTools(
      pi,
      {
        getConfig: () => DEFAULT_MULCH_CONFIG,
        getDetection: () => null,
        getTouchedFiles: () => [],
      },
      async () => ({
        command: "mulch",
        args: [],
        cwd: "/repo",
        exitCode: 0,
        stdout: "",
        stderr: "",
        ok: true,
      }),
    );

    const result = (await tools
      .get("mulch_prime")
      ?.execute("tool-null", {}, undefined, undefined, {
        cwd: "/repo",
      })) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      "Mulch is not ready in this repository.",
    );
  });

  it("mulch_status returns error when CLI is not available", async () => {
    const { pi, tools } = createMockPi();

    registerMulchTools(
      pi,
      {
        getConfig: () => DEFAULT_MULCH_CONFIG,
        getDetection: () => ({
          ...READY_DETECTION,
          cliAvailable: false,
          cliCommand: null,
          directoryExists: false,
          ready: false,
        }),
        getTouchedFiles: () => [],
      },
      async () => ({
        command: "mulch",
        args: [],
        cwd: "/repo",
        exitCode: 0,
        stdout: "",
        stderr: "",
        ok: true,
      }),
    );

    const result = (await tools
      .get("mulch_status")
      ?.execute("tool-no-cli", {}, undefined, undefined, {
        cwd: "/repo",
      })) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("Mulch CLI is not available.");
  });

  it("mulch_search surfaces error result when runner fails", async () => {
    const { pi, tools } = createMockPi();

    registerMulchTools(
      pi,
      {
        getConfig: () => DEFAULT_MULCH_CONFIG,
        getDetection: () => ({ ...READY_DETECTION }),
        getTouchedFiles: () => [],
      },
      async () => ({
        command: "mulch",
        args: ["search", "bad"],
        cwd: "/repo",
        exitCode: 1,
        stdout: "",
        stderr: "no results",
        ok: false,
      }),
    );

    const result = (await tools
      .get("mulch_search")
      ?.execute("tool-4", { query: "bad" }, undefined, undefined, {
        cwd: "/repo",
      })) as {
      isError: boolean;
      details: Record<string, unknown>;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBe(true);
    expect(result.details.success).toBe(false);
    expect(result.content[0]?.text).toContain("Command: mulch search bad");
    expect(result.content[0]?.text).toContain("Exit code: 1");
  });
});
