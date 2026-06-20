import type { ToolCommand } from "./legacy-cli.js";
export interface ToolExecutionResult {
    text: string;
    isError: boolean;
    rawResult: unknown;
}
export declare function executeToolCommand(command: ToolCommand, args: Record<string, unknown>): Promise<ToolExecutionResult>;
//# sourceMappingURL=tool-loopback.d.ts.map