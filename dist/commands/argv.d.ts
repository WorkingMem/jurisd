import type { ToolCommand } from "./legacy-cli.js";
/** Parse `--flag value` and `--flag=value` pairs out of an argv tail. */
export declare function parseFlags(args: string[], booleanFields?: string[]): {
    positional: string[];
    flags: Record<string, string>;
};
export declare function mapArgvToToolInput(command: ToolCommand, positional: string[], flags: Record<string, string>): Record<string, unknown>;
//# sourceMappingURL=argv.d.ts.map