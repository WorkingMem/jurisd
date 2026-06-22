import type { Readable, Writable } from "node:stream";
import { type ToolCommand } from "./commands/legacy-cli.js";
import { type ToolExecutionResult } from "./commands/tool-loopback.js";
import type { CommandContract } from "./commands/types.js";
export interface TuiIO {
    input: Readable;
    output: Writable;
    columns?: number;
    executor?: TuiCommandExecutor;
}
export type TuiCommandExecutor = (command: ToolCommand, args: Record<string, unknown>) => Promise<ToolExecutionResult>;
export declare function sanitizeTerminalText(value: string): string;
export declare function renderCommandOutput(text: string): string;
export declare function renderTuiToolResult(contract: CommandContract, result: ToolExecutionResult): string;
export declare function renderTuiHeader(width: number): string;
export declare function renderCommandPalette(width: number): string;
export declare function splitCommandLine(input: string): string[];
export declare function resolveTuiCommand(token: string): CommandContract | undefined;
export declare function renderTuiHelp(token?: string): string;
export declare function runTui(io: TuiIO): Promise<void>;
//# sourceMappingURL=tui.d.ts.map