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
import { mapArgvToToolInput, parseFlags } from "./commands/argv.js";
import { isSupportedCompletionShell, renderCompletion, renderCompletionUsage, } from "./commands/completions.js";
import { getCommandContractByCliName } from "./commands/contracts.js";
import { renderCommandHelp, renderCommandList, renderTopLevelHelp } from "./commands/help.js";
import { contractToToolCommand } from "./commands/legacy-cli.js";
import { executeToolCommand } from "./commands/tool-loopback.js";
import { fetchModule, verifyModule } from "./services/fetch-module.js";
import { listDataModules, setModulesRootForTest } from "./services/modules.js";
import { runTui, sanitizeTerminalText } from "./tui.js";
export { mapArgvToToolInput } from "./commands/argv.js";
const EXIT_SOURCE_UNAVAILABLE = 4;
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function isDegradedPayload(value) {
    return isRecord(value) && value.degraded === true;
}
function toolResultIsDegraded(result) {
    if (!isRecord(result))
        return false;
    const structured = result.structuredContent;
    return isRecord(structured) && isDegradedPayload(structured.data);
}
function safeDiagnosticText(value) {
    return sanitizeTerminalText(value).trim().slice(0, 80);
}
function quoteCommandArg(value, fallback) {
    const clean = value ? safeDiagnosticText(value) : fallback;
    return JSON.stringify(clean.length > 0 ? clean : fallback);
}
function renderSearchGroupGuidance(query) {
    const example = quoteCommandArg(query, "mabo");
    return [
        "jurisd search is a command group, not a single search command.",
        "Choose the source you want:",
        `  Live case law search: jurisd search-cases ${example} --format text`,
        `  Live legislation search: jurisd search-legislation ${example} --format text`,
        `  Installed offline modules: jurisd semantic-search-local ${example} --format text`,
        "",
        "For Mabo, start with live case law search. Local semantic search only works after an embedded data module is installed.",
    ].join("\n");
}
function renderUnknownCommand(command) {
    const clean = safeDiagnosticText(command) || "unknown";
    return [
        `unknown command: ${clean}`,
        "Run `jurisd --help` for the top-level commands or `jurisd help commands` for the full list.",
        "To run the MCP server explicitly, use `jurisd mcp serve` or run `jurisd` with no command.",
    ].join("\n");
}
/** Run a tool through the in-process loopback and stream its result to stdout. */
async function runToolCommand(command, positional, flags) {
    const args = mapArgvToToolInput(command, positional, flags);
    const result = await executeToolCommand(command, args);
    process.stdout.write(result.text);
    process.exitCode = result.isError
        ? 1
        : toolResultIsDegraded(result.rawResult)
            ? EXIT_SOURCE_UNAVAILABLE
            : 0;
}
/** One-line usage banner listing every available subcommand. */
function printHelp() {
    console.error(renderTopLevelHelp());
}
/**
 * Handle a CLI subcommand. Returns true when handled (process should exit with
 * `process.exitCode`), false when no subcommand was given.
 */
export async function runCli(argv) {
    const [command, ...rest] = argv;
    if (!command || command.startsWith("--")) {
        if (command === "--help") {
            printHelp();
            process.exitCode = 0;
            return true;
        }
        return false;
    }
    if (command === "help") {
        const topic = rest[0];
        if (!topic) {
            console.error(renderTopLevelHelp());
            process.exitCode = 0;
        }
        else if (topic === "commands") {
            console.error(renderCommandList());
            process.exitCode = 0;
        }
        else {
            const contract = getCommandContractByCliName(topic);
            console.error(contract ? renderCommandHelp(contract) : `unknown help topic: ${topic}`);
            process.exitCode = contract ? 0 : 2;
        }
        return true;
    }
    const contract = getCommandContractByCliName(command);
    if (contract && (rest.includes("--help") || rest.includes("-h"))) {
        console.error(renderCommandHelp(contract));
        process.exitCode = 0;
        return true;
    }
    if (command === "completion") {
        const shell = rest[0];
        if (!shell) {
            console.error(renderCompletionUsage());
            process.exitCode = 2;
            return true;
        }
        if (!isSupportedCompletionShell(shell)) {
            console.error("unsupported completion shell");
            console.error(renderCompletionUsage());
            process.exitCode = 2;
            return true;
        }
        process.stdout.write(renderCompletion(shell));
        process.exitCode = 0;
        return true;
    }
    if (command === "tui") {
        await runTui({ input: process.stdin, output: process.stdout });
        process.exitCode = 0;
        return true;
    }
    if (command === "mcp") {
        if (rest[0] === "serve")
            return false;
        console.error("usage: jurisd mcp serve");
        process.exitCode = 2;
        return true;
    }
    if (command === "search") {
        console.error(renderSearchGroupGuidance(rest[0]));
        process.exitCode = 2;
        return true;
    }
    const toolCommand = contract?.adapters.mcp.enabled ? contractToToolCommand(contract) : undefined;
    if (toolCommand) {
        const { positional, flags } = parseFlags(rest, toolCommand.boolean);
        if (flags["modules-dir"])
            setModulesRootForTest(flags["modules-dir"], true);
        if (positional.length < toolCommand.positional.length) {
            const fields = toolCommand.positional.map((f) => `<${f}>`).join(" ");
            console.error(`usage: jurisd ${command} ${fields} [--flag value ...]`);
            process.exitCode = 2;
            return true;
        }
        await runToolCommand(toolCommand, positional, flags);
        return true;
    }
    if (!["fetch-module", "verify-module", "list-modules"].includes(command)) {
        console.error(renderUnknownCommand(command));
        process.exitCode = 2;
        return true;
    }
    const { positional, flags } = parseFlags(rest);
    const modulesDir = flags["modules-dir"];
    // Point the loader at an explicit modules dir when given (CLI override).
    if (modulesDir)
        setModulesRootForTest(modulesDir, true);
    if (command === "fetch-module") {
        const name = positional[0];
        if (!name) {
            console.error("usage: jurisd fetch-module <name> [--manifest-url URL] [--modules-dir DIR]");
            process.exitCode = 2;
            return true;
        }
        const result = await fetchModule(name, {
            manifestUrl: flags["manifest-url"],
            modulesDir,
        });
        if (result.ok) {
            console.error(`installed module '${name}' to ${result.installedPath}`);
            if (result.attribution?.length) {
                console.error("Licence attribution (redistribution terms):");
                for (const line of result.attribution)
                    console.error(`  ${line}`);
            }
            process.exitCode = 0;
        }
        else {
            console.error(`fetch-module failed: ${result.error}`);
            process.exitCode = 1;
        }
        return true;
    }
    if (command === "verify-module") {
        const name = positional[0];
        if (!name) {
            console.error("usage: jurisd verify-module <name> [--modules-dir DIR]");
            process.exitCode = 2;
            return true;
        }
        const result = verifyModule(name, { modulesDir });
        if (result.ok) {
            console.error(`module '${name}' verified OK (${result.installedPath})`);
            process.exitCode = 0;
        }
        else {
            console.error(`verify-module failed: ${result.error}`);
            process.exitCode = 1;
        }
        return true;
    }
    // list-modules
    const modules = listDataModules({ refresh: true, includeInvalid: true });
    console.error(JSON.stringify({ count: modules.length, modules }, null, 2));
    process.exitCode = 0;
    return true;
}
//# sourceMappingURL=cli.js.map