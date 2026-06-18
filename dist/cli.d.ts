/**
 * Thin CLI subcommand dispatch.
 *
 * The entry point branches on `process.argv` before the server starts. No
 * heavyweight CLI framework — a thin switch over the first positional arg.
 *
 * Two families of subcommand exist:
 *
 *   Module management (run directly, before the server):
 *     jurisd fetch-module <name> [--manifest-url URL] [--modules-dir DIR]
 *     jurisd verify-module <name> [--modules-dir DIR]
 *     jurisd list-modules [--modules-dir DIR]
 *
 *   MCP-tool parity (routed through an in-process loopback to the SAME handlers
 *   any MCP client would hit, so the CLI cannot drift from the protocol):
 *     jurisd search-cases <query> [--jurisdiction nsw] [--limit 10] ...
 *     jurisd get-provision <act> <provision> ...
 *     jurisd format-citation <title> --neutral-citation '[1992] HCA 23' ...
 *     ... one subcommand per registered tool.
 *
 * `runCli` returns true when a subcommand was handled (and the process should
 * exit via `process.exitCode`), or false when no subcommand was given and the
 * server should start.
 */
import { type ToolCommand } from "./commands/legacy-cli.js";
/**
 * Pure mapping from parsed argv to a tool `arguments` object. Positional values
 * fill the command's positional fields in order; flags fill the remaining
 * fields with type coercion. Kept side-effect free so it is unit-testable
 * without a live loopback.
 */
export declare function mapArgvToToolInput(command: ToolCommand, positional: string[], flags: Record<string, string>): Record<string, unknown>;
/**
 * Handle a CLI subcommand. Returns true when handled (process should exit with
 * `process.exitCode`), false when no subcommand was given.
 */
export declare function runCli(argv: string[]): Promise<boolean>;
//# sourceMappingURL=cli.d.ts.map