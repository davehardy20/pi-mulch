import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { MulchConfig } from "./types.js";

export const DEFAULT_MULCH_CONFIG: MulchConfig = {
  enabled: true,
  command: null,
  cliCandidates: ["mulch", "ml"],
  injectionMode: "manifest",
  primeBudget: 4_000,
  promptOnMissingInit: true,
  persistInitDecline: true,
  draftMode: "session-end",
  draftDir: ".mulch/drafts",
  initStateFile: ".pi/mulch-integration.json",
  maxTrackedFiles: 24,
  llmTools: [
    "mulch_prime",
    "mulch_search",
    "mulch_query",
    "mulch_learn",
    "mulch_status",
  ],
};

interface SettingsRecord {
  mulch?: Record<string, unknown>;
  extensions?: {
    mulch?: Record<string, unknown>;
  };
}

export interface LoadConfigDeps {
  readFileSync?: typeof fs.readFileSync;
  existsSync?: typeof fs.existsSync;
  homedir?: typeof os.homedir;
}

export function getSettingsPaths(
  cwd: string,
  homedir = os.homedir(),
): {
  globalPath: string;
  projectPath: string;
} {
  return {
    globalPath: path.join(homedir, ".pi", "agent", "settings.json"),
    projectPath: path.join(cwd, ".pi", "settings.json"),
  };
}

export function loadMulchConfig(
  cwd: string,
  deps: LoadConfigDeps = {},
): MulchConfig {
  const readFileSync = deps.readFileSync ?? fs.readFileSync;
  const existsSync = deps.existsSync ?? fs.existsSync;
  const { globalPath, projectPath } = getSettingsPaths(
    cwd,
    (deps.homedir ?? os.homedir)(),
  );

  const globalSettings = readSettingsFile(globalPath, readFileSync, existsSync);
  const projectSettings = readSettingsFile(
    projectPath,
    readFileSync,
    existsSync,
  );

  return normalizeMulchConfig({
    ...extractMulchSettings(globalSettings),
    ...extractMulchSettings(projectSettings),
  });
}

export function normalizeMulchConfig(
  input: Record<string, unknown>,
): MulchConfig {
  const cliCandidates = normalizeStringArray(input.cliCandidates);
  const llmTools = normalizeStringArray(input.llmTools).filter(
    (value): value is MulchConfig["llmTools"][number] =>
      [
        "mulch_prime",
        "mulch_search",
        "mulch_query",
        "mulch_learn",
        "mulch_status",
      ].includes(value),
  );

  return {
    enabled:
      typeof input.enabled === "boolean"
        ? input.enabled
        : DEFAULT_MULCH_CONFIG.enabled,
    command:
      typeof input.command === "string" && input.command.trim().length > 0
        ? input.command.trim()
        : DEFAULT_MULCH_CONFIG.command,
    cliCandidates:
      cliCandidates.length > 0
        ? Array.from(new Set(cliCandidates))
        : DEFAULT_MULCH_CONFIG.cliCandidates,
    injectionMode:
      input.injectionMode === "manifest"
        ? "manifest"
        : DEFAULT_MULCH_CONFIG.injectionMode,
    primeBudget:
      typeof input.primeBudget === "number" && input.primeBudget > 0
        ? Math.floor(input.primeBudget)
        : DEFAULT_MULCH_CONFIG.primeBudget,
    promptOnMissingInit:
      typeof input.promptOnMissingInit === "boolean"
        ? input.promptOnMissingInit
        : DEFAULT_MULCH_CONFIG.promptOnMissingInit,
    persistInitDecline:
      typeof input.persistInitDecline === "boolean"
        ? input.persistInitDecline
        : DEFAULT_MULCH_CONFIG.persistInitDecline,
    draftMode:
      input.draftMode === "off" || input.draftMode === "session-end"
        ? input.draftMode
        : DEFAULT_MULCH_CONFIG.draftMode,
    draftDir:
      typeof input.draftDir === "string" && input.draftDir.trim().length > 0
        ? input.draftDir.trim()
        : DEFAULT_MULCH_CONFIG.draftDir,
    initStateFile:
      typeof input.initStateFile === "string" &&
      input.initStateFile.trim().length > 0
        ? input.initStateFile.trim()
        : DEFAULT_MULCH_CONFIG.initStateFile,
    maxTrackedFiles:
      typeof input.maxTrackedFiles === "number" && input.maxTrackedFiles > 0
        ? Math.floor(input.maxTrackedFiles)
        : DEFAULT_MULCH_CONFIG.maxTrackedFiles,
    llmTools:
      llmTools.length > 0
        ? Array.from(new Set(llmTools))
        : DEFAULT_MULCH_CONFIG.llmTools,
  };
}

function readSettingsFile(
  filePath: string,
  readFileSync: typeof fs.readFileSync,
  existsSync: typeof fs.existsSync,
): SettingsRecord {
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    const content = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(content) as SettingsRecord;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function extractMulchSettings(
  settings: SettingsRecord,
): Record<string, unknown> {
  if (settings.mulch && typeof settings.mulch === "object") {
    return settings.mulch;
  }
  if (
    settings.extensions?.mulch &&
    typeof settings.extensions.mulch === "object"
  ) {
    return settings.extensions.mulch;
  }
  return {};
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
