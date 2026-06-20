import type { CommandContract } from "./types.js";
export declare const SUPPORTED_COMPLETION_SHELLS: readonly ["bash", "zsh", "fish"];
export type CompletionShell = (typeof SUPPORTED_COMPLETION_SHELLS)[number];
type CompletionModel = {
    rootCommands: string[];
    commandCandidates: Record<string, string[]>;
};
export declare function isSupportedCompletionShell(shell: string): shell is CompletionShell;
export declare function normaliseCompletionValue(value: string): string;
export declare function isUnsafeTerminalCode(code: number): boolean;
export declare function buildCompletionModel(contracts?: CommandContract[]): CompletionModel;
export declare function escapeAnsiCString(value: string): string;
export declare function escapeFishSingleQuoted(value: string): string;
export declare function renderBashCompletion(model?: CompletionModel): string;
export declare function renderZshCompletion(model?: CompletionModel): string;
export declare function renderFishCompletion(model?: CompletionModel): string;
export declare function renderCompletion(shell: CompletionShell): string;
export declare function renderCompletionUsage(): string;
export {};
//# sourceMappingURL=completions.d.ts.map