export function contractToToolCommand(contract) {
    if (!contract.adapters.mcp.enabled || !contract.adapters.mcp.toolName) {
        throw new Error(`Command ${contract.id} is not backed by an MCP tool`);
    }
    return {
        tool: contract.adapters.mcp.toolName,
        positional: contract.adapters.cli.positional,
        numeric: contract.adapters.cli.numeric,
        boolean: contract.adapters.cli.boolean,
        array: contract.adapters.cli.array,
    };
}
//# sourceMappingURL=legacy-cli.js.map