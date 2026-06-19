import { createInterface } from "node:readline/promises";
import { mapArgvToToolInput, parseFlags } from "./commands/argv.js";
import { isUnsafeTerminalCode } from "./commands/completions.js";
import { COMMAND_CONTRACTS, getCommandContractByCliName } from "./commands/contracts.js";
import { contractToToolCommand } from "./commands/legacy-cli.js";
import { executeToolCommand } from "./commands/tool-loopback.js";
const TUI_ALLOWED_SIDE_EFFECTS = new Set([
    "read_only_query",
    "local_metadata_read",
]);
function skipOscSequence(value, index) {
    let cursor = index + 2;
    while (cursor < value.length) {
        const code = value.charCodeAt(cursor);
        if (code === 0x07)
            return cursor + 1;
        if (code === 0x1b && value[cursor + 1] === "\\")
            return cursor + 2;
        cursor += 1;
    }
    return value.length;
}
function skipCsiSequence(value, index) {
    let cursor = index + 2;
    while (cursor < value.length) {
        const code = value.charCodeAt(cursor);
        if (code >= 0x40 && code <= 0x7e)
            return cursor + 1;
        cursor += 1;
    }
    return value.length;
}
function isControlCharacter(char) {
    return char !== "\n" && char !== "\t" && isUnsafeTerminalCode(char.codePointAt(0));
}
function resolveColumns(io) {
    const streamColumns = "columns" in io.output ? Number(io.output.columns) : NaN;
    const envColumns = Number(process.env.COLUMNS);
    const value = io.columns ?? (Number.isFinite(envColumns) ? envColumns : streamColumns);
    return Number.isFinite(value) && value > 0 ? Math.max(32, Math.floor(value)) : 80;
}
function fit(line, width) {
    if (line.length <= width)
        return line;
    if (width <= 4)
        return line.slice(0, width);
    return `${line.slice(0, width - 3)}...`;
}
export function sanitizeTerminalText(value) {
    let output = "";
    for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        if (char === "\r") {
            output += "\n";
            if (value[index + 1] === "\n")
                index += 1;
            continue;
        }
        if (char === "\u001b") {
            const next = value[index + 1];
            if (next === "]") {
                index = skipOscSequence(value, index) - 1;
                continue;
            }
            if (next === "[") {
                index = skipCsiSequence(value, index) - 1;
                continue;
            }
            index += 1;
            continue;
        }
        if (isControlCharacter(char))
            continue;
        output += char;
    }
    return output;
}
function writeLine(output, width, line = "") {
    for (const cleanLine of sanitizeTerminalText(line).split("\n")) {
        output.write(`${fit(cleanLine, width)}\n`);
    }
}
export function renderCommandOutput(text) {
    const cleanText = sanitizeTerminalText(text);
    if (!cleanText)
        return "";
    return cleanText.endsWith("\n") ? cleanText : `${cleanText}\n`;
}
function writeCommandOutput(output, text) {
    output.write(renderCommandOutput(text));
}
function renderContractLine(contract) {
    const cli = contract.adapters.cli.canonicalName ?? contract.id;
    const label = contract.adapters.tui.label ?? contract.summary;
    return `${contract.id} /${cli} - ${label}`;
}
function isTuiExecutableContract(contract) {
    return (contract.adapters.cli.enabled &&
        contract.adapters.mcp.enabled &&
        contract.adapters.tui.enabled &&
        TUI_ALLOWED_SIDE_EFFECTS.has(contract.sideEffectClass) &&
        !contract.dangerous &&
        !contract.requiresConfirmation);
}
export function renderTuiHeader(width) {
    return [
        "jurisd TUI scaffold",
        `width ${width}: inline transcript/composer`,
        "framework: Node readline, no fullscreen terminal control in WB3",
        "future panes: sources, corpus, graph, review (inactive placeholders)",
        "commands: /commands, /help, /<command-id|cli-name> [args], /quit",
    ]
        .map((line) => fit(line, width))
        .join("\n");
}
export function renderCommandPalette(width) {
    const lines = COMMAND_CONTRACTS.filter(isTuiExecutableContract)
        .map(renderContractLine)
        .sort()
        .map((line) => fit(line, width));
    return ["Command palette:", ...lines].join("\n");
}
export function splitCommandLine(input) {
    const tokens = [];
    let current = "";
    let quote = null;
    for (let i = 0; i < input.length; i++) {
        const char = input[i];
        if (quote) {
            if (char === quote) {
                quote = null;
            }
            else {
                current += char;
            }
        }
        else if (char === '"' || char === "'") {
            quote = char;
        }
        else if (/\s/.test(char)) {
            if (current) {
                tokens.push(current);
                current = "";
            }
        }
        else {
            current += char;
        }
    }
    if (current)
        tokens.push(current);
    return tokens;
}
export function resolveTuiCommand(token) {
    const contract = findTuiCommandCandidate(token);
    return contract && isTuiExecutableContract(contract) ? contract : undefined;
}
function findTuiCommandCandidate(token) {
    return (COMMAND_CONTRACTS.find((contract) => contract.id === token) ??
        getCommandContractByCliName(token));
}
async function dispatchSlashCommand(line, output, width) {
    const parts = splitCommandLine(line.slice(1));
    const token = parts[0];
    if (!token)
        return true;
    if (token === "quit" || token === "exit") {
        writeLine(output, width, "goodbye");
        return false;
    }
    if (token === "help") {
        writeLine(output, width, "Slash commands resolve through the command contract registry.");
        writeLine(output, width, "Use /commands to inspect available governed commands.");
        return true;
    }
    if (token === "commands") {
        writeLine(output, width, renderCommandPalette(width));
        return true;
    }
    const contract = findTuiCommandCandidate(token);
    if (!contract) {
        writeLine(output, width, `unknown slash command: ${token}`);
        return true;
    }
    if (!isTuiExecutableContract(contract)) {
        writeLine(output, width, `registered command ${contract.id} is not enabled for WB3 TUI dispatch`);
        return true;
    }
    const toolCommand = contractToToolCommand(contract);
    const { positional, flags } = parseFlags(parts.slice(1), toolCommand.boolean);
    if (positional.length < toolCommand.positional.length) {
        const fields = toolCommand.positional.map((field) => `<${field}>`).join(" ");
        writeLine(output, width, `usage: /${contract.id} ${fields} [--flag value ...]`);
        return true;
    }
    writeLine(output, width, `dispatch: ${contract.id}`);
    const args = mapArgvToToolInput(toolCommand, positional, flags);
    const result = await executeToolCommand(toolCommand, args);
    writeCommandOutput(output, result.text);
    if (result.isError)
        writeLine(output, width, `result: error from ${contract.id}`);
    return true;
}
export async function runTui(io) {
    const width = resolveColumns(io);
    const interactive = Boolean(io.input.isTTY);
    writeLine(io.output, width, renderTuiHeader(width));
    writeLine(io.output, width);
    writeLine(io.output, width, renderCommandPalette(width));
    writeLine(io.output, width);
    const rl = createInterface({
        input: io.input,
        output: io.output,
        terminal: interactive,
    });
    rl.setPrompt("jurisd> ");
    if (interactive)
        rl.prompt();
    for await (const line of rl) {
        const trimmed = sanitizeTerminalText(line).trim();
        if (!trimmed) {
            if (interactive)
                rl.prompt();
            continue;
        }
        writeLine(io.output, width, `transcript> ${trimmed}`);
        if (trimmed.startsWith("/")) {
            const keepRunning = await dispatchSlashCommand(trimmed, io.output, width);
            if (!keepRunning)
                break;
        }
        else {
            writeLine(io.output, width, "composer captured text; agentic drafting is not implemented in WB3");
        }
        if (interactive)
            rl.prompt();
    }
    rl.close();
}
//# sourceMappingURL=tui.js.map