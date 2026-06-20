import type { CommandContract } from "./types.js";

export interface ToolCommand {
  tool: string;
  positional: string[];
  numeric: string[];
  boolean: string[];
  array: string[];
}

export function contractToToolCommand(contract: CommandContract): ToolCommand {
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
