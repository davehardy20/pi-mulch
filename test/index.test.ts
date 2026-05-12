import { describe, expect, it } from "vitest";
import mulchIntegrationExtension from "../src/index.js";

describe("pi-mulch-integration package", () => {
	it("exports a default extension factory", () => {
		expect(typeof mulchIntegrationExtension).toBe("function");
	});

	it("registers hooks, commands, and tools", () => {
		const registered = {
			events: [] as string[],
			commands: [] as string[],
			tools: [] as string[],
		};

		const mockPi = {
			on: (event: string, _handler: unknown) => {
				registered.events.push(event);
			},
			registerCommand: (name: string, _def: unknown) => {
				registered.commands.push(name);
			},
			registerTool: (def: { name: string }) => {
				registered.tools.push(def.name);
			},
			sendMessage: () => undefined,
		};

		mulchIntegrationExtension(
			mockPi as unknown as Parameters<typeof mulchIntegrationExtension>[0],
		);

		expect(registered.events).toEqual(
			expect.arrayContaining([
				"session_start",
				"tool_call",
				"tool_result",
				"before_agent_start",
				"session_shutdown",
			]),
		);

		expect(registered.commands).toEqual(
			expect.arrayContaining([
				"mulch-init",
				"mulch-prime",
				"mulch-search",
				"mulch-query",
				"mulch-learn",
				"mulch-status",
				"mulch-review",
				"mulch-apply",
			]),
		);

		expect(registered.tools).toEqual(
			expect.arrayContaining([
				"mulch_prime",
				"mulch_search",
				"mulch_query",
				"mulch_learn",
				"mulch_status",
			]),
		);
	});
});
