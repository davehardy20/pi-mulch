/**
 * Mulch-specific settings parsing and defaults.
 *
 * Configuration is loaded from:
 * 1. Project-local `.mulch/mulch.config.yaml` under a `pi:` key
 * 2. Global `~/.pi/agent/settings.json` under a `mulch` key
 * 3. Built-in defaults
 */

import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import type { PiMulchConfig } from "./types.js";

export const DEFAULT_CONFIG: PiMulchConfig = {
  enabled: true,
  command: "mulch",
  injectionMode: "manifest",
  injectionBudget: 4000,
  suppressInitPrompt: false,
  draftMode: "auto",
  autoLearnDomains: [],
};

/**
 * Attempt to parse mulch config from project-local yaml.
 * Simple parser for the `pi:` section — no YAML library dependency.
 */
function parseProjectConfig(
  mulchDir: string,
): Partial<PiMulchConfig> | null {
  const configPath = resolve(mulchDir, "mulch.config.yaml");
  if (!existsSync(configPath)) return null;

  try {
    const content = readFileSync(configPath, "utf-8");
    const piSection = extractYamlSection(content, "pi");
    if (!piSection) return null;
    return parseSimpleYaml(piSection);
  } catch {
    return null;
  }
}

/**
 * Extract a top-level section from YAML content.
 * Returns the text of the section's value (indented block).
 */
function extractYamlSection(
  yaml: string,
  key: string,
): string | null {
  const lines = yaml.split("\n");
  let startIdx = -1;
  let indent = 0;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(
      new RegExp(`^(\\s*)${key}\\s*:\\s*(.*)$`),
    );
    if (match) {
      startIdx = i;
      indent = match[1].length;
      if (match[2].trim()) {
        return match[2].trim();
      }
      break;
    }
  }

  if (startIdx === -1) return null;

  const sectionLines: string[] = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "" || line.match(/^\s*#/)) {
      sectionLines.push(line);
      continue;
    }
    const lineIndent = line.match(/^(\s*)/)?.[1].length ?? 0;
    if (lineIndent <= indent) break;
    sectionLines.push(line);
  }

  return sectionLines.join("\n");
}

/**
 * Simple YAML parser for flat key-value pairs.
 */
function parseSimpleYaml(
  content: string,
): Partial<PiMulchConfig> {
  const result: Record<string, unknown> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(\w[\w-]*)\s*:\s*(.+)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    result[key] = parseYamlValue(rawValue.trim());
  }
  return result as Partial<PiMulchConfig>;
}

function parseYamlValue(value: string): unknown {
  const commentIdx = value.indexOf(" #");
  if (commentIdx !== -1) value = value.slice(0, commentIdx).trim();

  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((s) => parseYamlValue(s.trim()))
      .filter((v) => v !== "");
  }
  if (value === "null" || value === "~") return null;
  return value;
}

/**
 * Load and merge Mulch configuration.
 */
export function loadMulchConfig(
  cwd: string,
  mulchDir: string | null,
  globalSettings?: Record<string, unknown>,
): PiMulchConfig {
  const config = { ...DEFAULT_CONFIG };

  if (globalSettings?.mulch && typeof globalSettings.mulch === "object") {
    Object.assign(config, globalSettings.mulch);
  }

  if (mulchDir) {
    const projectConfig = parseProjectConfig(mulchDir);
    if (projectConfig) {
      for (const [key, value] of Object.entries(projectConfig)) {
        if (value !== undefined && value !== null) {
          (config as Record<string, unknown>)[key] = value;
        }
      }
    }
  }

  return config;
}

/**
 * Simplified config loader used by the extension entrypoint.
 */
export function loadConfig(
  cwd: string,
  globalSettings?: Record<string, unknown>,
): PiMulchConfig {
  return loadMulchConfig(cwd, null, globalSettings);
}

// --- Init-decline persistence (repo-local) ---

const INIT_SUPPRESSED_FILE = ".mulch/.pi-init-suppressed";

/**
 * Check whether init prompting is declined for a given cwd.
 */
export function isInitDeclined(cwd: string): boolean {
  const markerPath = resolve(cwd, INIT_SUPPRESSED_FILE);
  return existsSync(markerPath);
}

/**
 * Persistently mark init as declined for a repo.
 */
export function setInitDeclined(cwd: string, _value: boolean): void {
  const mulchDir = resolve(cwd, ".mulch");
  if (!existsSync(mulchDir)) {
    mkdirSync(mulchDir, { recursive: true });
  }
  const markerPath = resolve(cwd, INIT_SUPPRESSED_FILE);
  writeFileSync(
    markerPath,
    "# pi-mulch extension: init prompting suppressed\n# Created: " +
      new Date().toISOString() +
      "\n",
    "utf-8",
  );
}
