export interface ExtensionEvent {
	reason?: string;
	prompt?: string;
	toolName?: string;
	input?: unknown;
	details?: unknown;
}

export interface ToolParams {
	files?: string[];
	budget?: number;
	fullOutput?: boolean;
	query: string;
	domain?: string;
	file?: string;
	type?: string;
	all?: boolean;
}

export interface ExtensionAPI {
	on(
		event: string,
		handler: (
			event: ExtensionEvent,
			ctx: ExtensionContext,
		) => Promise<unknown> | unknown,
	): void;
	registerCommand(name: string, command: ExtensionCommand): void;
	registerTool(tool: ExtensionTool): void;
	sendMessage(message: Record<string, unknown>): void;
}

export interface ExtensionContext {
	cwd: string;
	hasUI?: boolean;
	signal?: AbortSignal;
	ui: {
		setStatus(name: string, value: string): void;
		notify(message: string, level?: string): void;
		confirm(title: string, message?: string): Promise<boolean> | boolean;
		editor(
			title: string,
			value?: string,
		): Promise<string | undefined> | string | undefined;
	};
	sessionManager: {
		getEntries(): SessionEntry[];
	};
}

export type ExtensionCommandContext = ExtensionContext & {
	sessionManager: {
		getEntries(): SessionEntry[];
	};
};

export interface ExtensionCommand {
	description?: string;
	handler(
		args: string,
		ctx: ExtensionCommandContext,
	): Promise<unknown> | unknown;
}

export interface ExtensionTool {
	name: string;
	label?: string;
	description?: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
	parameters?: unknown;
	execute(
		toolCallId: string,
		params: ToolParams,
		signal: AbortSignal | undefined,
		onUpdate: unknown,
		ctx: ExtensionContext,
	): Promise<unknown> | unknown;
}

export interface ToolCallEvent {
	toolName?: string;
	input?: unknown;
}

export interface ToolResultEvent {
	toolName?: string;
	input?: unknown;
	details?: unknown;
}

export interface SessionEntry {
	type?: string;
	customType?: string;
	content?: unknown;
	details?: unknown;
}
