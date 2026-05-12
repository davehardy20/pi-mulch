import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import type { MulchDetectionResult } from "./detect.js";
import {
  formatMulchResult,
  type RunMulchCommandDeps,
  runMulchCommand,
} from "./exec.js";
import { buildPrimeRequest } from "./prime.js";
import type { MulchConfig } from "./types.js";

export interface ToolRuntime {
  getConfig(): MulchConfig;
  getDetection(cwd: string): MulchDetectionResult | null;
  getTouchedFiles(): string[];
}

export function registerMulchTools(
  pi: ExtensionAPI,
  runtime: ToolRuntime,
  runner: typeof runMulchCommand = runMulchCommand,
  deps: RunMulchCommandDeps = {},
): void {
  const enabled = new Set(runtime.getConfig().llmTools);

  if (enabled.has("mulch_prime")) {
    pi.registerTool({
      name: "mulch_prime",
      label: "Mulch Prime",
      description:
        "Prime Mulch context using manifest mode or file-scoped records.",
      promptSnippet:
        "Use mulch_prime to load Mulch context before deeper repository reasoning.",
      promptGuidelines: [
        "Use mulch_prime when the task benefits from project-specific expertise already stored in Mulch.",
      ],
      parameters: Type.Object({
        files: Type.Optional(Type.Array(Type.String())),
        budget: Type.Optional(Type.Number({ minimum: 1 })),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        const detection = runtime.getDetection(ctx.cwd);
        if (!detection?.ready || !detection.cliCommand) {
          return errorToolResult("Mulch is not ready in this repository.");
        }

        const config = runtime.getConfig();
        const request = buildPrimeRequest(
          detection,
          params.files && params.files.length > 0
            ? params.files.map((filePath) => filePath)
            : runtime.getTouchedFiles(),
          {
            ...config,
            primeBudget: params.budget ?? config.primeBudget,
          },
        );
        const result = await runner(
          {
            command: detection.cliCommand,
            args: request.args,
            cwd: detection.commandCwd,
            signal,
          },
          deps,
        );
        return toolResult(result);
      },
    });
  }

  if (enabled.has("mulch_search")) {
    pi.registerTool({
      name: "mulch_search",
      label: "Mulch Search",
      description: "Search Mulch expertise across domains.",
      promptSnippet:
        "Use mulch_search to find relevant Mulch records by query.",
      parameters: Type.Object({
        query: Type.String({ minLength: 1 }),
        domain: Type.Optional(Type.String()),
        file: Type.Optional(Type.String()),
        type: Type.Optional(Type.String()),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        const detection = runtime.getDetection(ctx.cwd);
        if (!detection?.ready || !detection.cliCommand) {
          return errorToolResult("Mulch is not ready in this repository.");
        }

        const args = ["search", params.query];
        if (params.domain) args.push("--domain", params.domain);
        if (params.file) args.push("--file", params.file);
        if (params.type) args.push("--type", params.type);
        const result = await runner(
          {
            command: detection.cliCommand,
            args,
            cwd: detection.commandCwd,
            json: true,
            signal,
          },
          deps,
        );
        return toolResult(result);
      },
    });
  }

  if (enabled.has("mulch_query")) {
    pi.registerTool({
      name: "mulch_query",
      label: "Mulch Query",
      description: "Query Mulch records for one domain or all domains.",
      promptSnippet:
        "Use mulch_query to inspect records directly when you already know the target domain.",
      parameters: Type.Object({
        domain: Type.Optional(Type.String()),
        file: Type.Optional(Type.String()),
        type: Type.Optional(Type.String()),
        all: Type.Optional(Type.Boolean()),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        const detection = runtime.getDetection(ctx.cwd);
        if (!detection?.ready || !detection.cliCommand) {
          return errorToolResult("Mulch is not ready in this repository.");
        }

        const args = ["query"];
        if (params.domain) args.push(params.domain);
        if (params.file) args.push("--file", params.file);
        if (params.type) args.push("--type", params.type);
        if (params.all) args.push("--all");
        const result = await runner(
          {
            command: detection.cliCommand,
            args,
            cwd: detection.commandCwd,
            json: true,
            signal,
          },
          deps,
        );
        return toolResult(result);
      },
    });
  }

  if (enabled.has("mulch_learn")) {
    pi.registerTool({
      name: "mulch_learn",
      label: "Mulch Learn",
      description:
        "Show changed files and Mulch domain suggestions for learnings.",
      promptSnippet:
        "Use mulch_learn to inspect what Mulch thinks is worth recording from current changes.",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
        const detection = runtime.getDetection(ctx.cwd);
        if (!detection?.ready || !detection.cliCommand) {
          return errorToolResult("Mulch is not ready in this repository.");
        }

        const result = await runner(
          {
            command: detection.cliCommand,
            args: ["learn"],
            cwd: detection.commandCwd,
            json: true,
            signal,
          },
          deps,
        );
        return toolResult(result);
      },
    });
  }

  if (enabled.has("mulch_status")) {
    pi.registerTool({
      name: "mulch_status",
      label: "Mulch Status",
      description: "Show current Mulch domain and governance status.",
      promptSnippet:
        "Use mulch_status to inspect Mulch repository readiness and domain counts.",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
        const detection = runtime.getDetection(ctx.cwd);
        if (!detection?.cliAvailable || !detection.cliCommand) {
          return errorToolResult("Mulch CLI is not available.");
        }

        const result = await runner(
          {
            command: detection.cliCommand,
            args: detection.directoryExists ? ["status"] : ["--version"],
            cwd: detection.commandCwd,
            json: detection.directoryExists,
            signal,
          },
          deps,
        );
        return toolResult(result);
      },
    });
  }
}

function errorToolResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    details: { success: false },
    isError: true,
  };
}

function toolResult(result: Awaited<ReturnType<typeof runMulchCommand>>) {
  const text = result.json
    ? JSON.stringify(result.json, null, 2)
    : formatMulchResult(result);

  return {
    content: [{ type: "text" as const, text }],
    details: {
      command: `${result.command} ${result.args.join(" ")}`.trim(),
      exitCode: result.exitCode,
      success: result.ok,
      json: result.json,
    },
    isError: !result.ok,
  };
}
