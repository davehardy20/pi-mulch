import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	DEFAULT_MULCH_CONFIG,
	loadMulchConfig,
	normalizeMulchConfig,
} from "../src/config.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-mulch-config-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("DEFAULT_MULCH_CONFIG", () => {
	it("includes both mulch and ml as default cliCandidates", () => {
		expect(DEFAULT_MULCH_CONFIG.cliCandidates).toEqual(["mulch", "ml"]);
	});

	it("defaults command to null for auto-detection", () => {
		expect(DEFAULT_MULCH_CONFIG.command).toBeNull();
	});
});

describe("normalizeMulchConfig", () => {
	it("falls back to defaults for invalid values", () => {
		expect(
			normalizeMulchConfig({
				enabled: "yes",
				primeBudget: -1,
				cliCandidates: ["mulch", "", 42],
				llmTools: ["mulch_status", "bogus"],
			} as never),
		).toEqual({
			...DEFAULT_MULCH_CONFIG,
			cliCandidates: ["mulch"],
			llmTools: ["mulch_status"],
		});
	});
});

describe("loadMulchConfig", () => {
	it("merges global and project mulch settings", () => {
		const home = makeTempDir();
		const cwd = makeTempDir();
		fs.mkdirSync(path.join(home, ".pi", "agent"), { recursive: true });
		fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });

		fs.writeFileSync(
			path.join(home, ".pi", "agent", "settings.json"),
			JSON.stringify({
				mulch: {
					enabled: false,
					command: "mulch",
					cliCandidates: ["mulch", "ml"],
					primeBudget: 1234,
				},
			}),
		);
		fs.writeFileSync(
			path.join(cwd, ".pi", "settings.json"),
			JSON.stringify({
				mulch: {
					enabled: true,
					command: "repo-local-cli",
					cliCandidates: ["repo-local-cli"],
					draftMode: "off",
				},
			}),
		);

		expect(loadMulchConfig(cwd, { homedir: () => home })).toEqual({
			...DEFAULT_MULCH_CONFIG,
			enabled: true,
			command: "mulch",
			cliCandidates: ["mulch", "ml"],
			primeBudget: 1234,
			draftMode: "off",
		});
	});

	it("supports extensions.mulch and tolerates invalid JSON", () => {
		const home = makeTempDir();
		const cwd = makeTempDir();
		fs.mkdirSync(path.join(home, ".pi", "agent"), { recursive: true });
		fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });

		fs.writeFileSync(
			path.join(home, ".pi", "agent", "settings.json"),
			"{not-json",
		);
		fs.writeFileSync(
			path.join(cwd, ".pi", "settings.json"),
			JSON.stringify({
				extensions: {
					mulch: {
						maxTrackedFiles: 99,
					},
				},
			}),
		);

		expect(loadMulchConfig(cwd, { homedir: () => home })).toEqual({
			...DEFAULT_MULCH_CONFIG,
			maxTrackedFiles: 99,
		});
	});
});
