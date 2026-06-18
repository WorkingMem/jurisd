import type { CommandContract } from "./types.js";
export interface ToolCommand {
    tool: string;
    positional: string[];
    numeric: string[];
    boolean: string[];
    array: string[];
}
export declare function contractToToolCommand(contract: CommandContract): ToolCommand;
//# sourceMappingURL=legacy-cli.d.ts.map