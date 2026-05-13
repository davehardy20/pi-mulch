import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_MULCH_CONFIG } from "../src/config.js";
import {
	getRepoInitStatePath,
	loadRepoInitState,
	saveRepoInitState,
} from "../src/state.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-mulch-state-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("repo init state path safety", () => {
	it("keeps init state inside the repo when config escapes", () => {
		const repoRoot = makeTempDir();
		const config = {
			...DEFAULT_MULCH_CONFIG,
			initStateFile: "../outside-state.json",
		};

		const filePath = saveRepoInitState(repoRoot, config, {
			suppressInitPrompt: true,
		});

		expect(filePath).toBe(path.join(repoRoot, ".pi", "mulch-integration.json"));
		expect(getRepoInitStatePath(repoRoot, config)).toBe(filePath);
		expect(loadRepoInitState(repoRoot, config)).toEqual({
			suppressInitPrompt: true,
		});
		expect(fs.existsSync(path.resolve(repoRoot, "../outside-state.json"))).toBe(
			false,
		);
	});
});
