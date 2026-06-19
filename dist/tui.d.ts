import type { Readable, Writable } from "node:stream";
import type { CommandContract } from "./commands/types.js";
export interface TuiIO {
    input: Readable;
    output: Writable;
    columns?: number;
}
export declare function sanitizeTerminalText(value: string): string;
export declare function renderCommandOutput(text: string): string;
export declare function renderTuiHeader(width: number): string;
export declare function renderCommandPalette(width: number): string;
export declare function splitCommandLine(input: string): string[];
export declare function resolveTuiCommand(token: string): CommandContract | undefined;
export declare function runTui(io: TuiIO): Promise<void>;
//# sourceMappingURL=tui.d.ts.map