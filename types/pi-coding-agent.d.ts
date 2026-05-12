declare module "@earendil-works/pi-coding-agent" {
  export interface ExtensionContext {
    cwd: string;
    hasUI: boolean;
    ui: {
      notify(message: string, level: "info" | "warning" | "error" | "success"): void;
      confirm(title: string, message: string): Promise<boolean>;
      select(title: string, items: string[]): Promise<string | null>;
      input(title: string, options?: { defaultValue?: string }): Promise<string | null>;
      setStatus(key: string, text: string | undefined): void;
    };
    sessionManager: {
      getBranch(): Array<{
        type: string;
        customType?: string;
        details?: Record<string, unknown>;
      }>;
    };
    signal?: AbortSignal;
    isIdle(): boolean;
    getSystemPrompt(): string;
  }

  export interface ExtensionCommandContext extends ExtensionContext {
    waitForIdle(): Promise<void>;
  }

  export interface ExtensionAPI {
    on(
      event: string,
      handler: (event: unknown, ctx: ExtensionContext) => Promise<unknown | void>,
    ): void;
    registerTool(definition: unknown): void;
    registerCommand(name: string, options: {
      description?: string;
      getArgumentCompletions?: (prefix: string) => Array<{ value: string; label: string }> | null;
      handler: (args: string | undefined, ctx: ExtensionCommandContext) => Promise<void>;
    }): void;
    registerShortcut(shortcut: string, options: {
      description?: string;
      handler: (ctx: ExtensionContext) => Promise<void>;
    }): void;
    sendMessage(
      message: {
        customType?: string;
        content: string;
        display: boolean;
        details?: Record<string, unknown>;
      },
      options?: { deliverAs?: "steer" | "followUp" | "nextTurn"; triggerTurn?: boolean },
    ): void;
    sendUserMessage(content: string, options?: { deliverAs?: "steer" | "followUp" | "nextTurn" }): void;
    appendEntry(customType: string, data?: unknown): void;
    getCommands(): Array<{
      name: string;
      description?: string;
      source: string;
      sourceInfo: { path: string; source: string; scope: string; origin: string };
    }>;
    exec(command: string, args: string[], options?: { signal?: AbortSignal; timeout?: number }): Promise<{
      stdout: string;
      stderr: string;
      code: number;
    }>;
  }
}
