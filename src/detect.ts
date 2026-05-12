import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { MulchDetection } from "./types.js";

export function detectMulch(cwd: string, command: string): MulchDetection {
  const dotMulchExists = fs.existsSync(path.join(cwd, ".mulch"));

  const candidates = [command, "mulch", "ml"];
  for (const candidate of candidates) {
    try {
      const version = execSync(`${candidate} --version`, {
        encoding: "utf8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "ignore"],
      }).trim();
      return {
        cliAvailable: true,
        cliCommand: candidate,
        dotMulchExists,
        version,
      };
    } catch {
      // try next candidate
    }
  }

  return {
    cliAvailable: false,
    cliCommand: command,
    dotMulchExists,
  };
}
