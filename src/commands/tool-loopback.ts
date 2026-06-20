import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createMcpServer } from "../server.js";
import type { ToolCommand } from "./legacy-cli.js";

export interface ToolExecutionResult {
  text: string;
  isError: boolean;
  rawResult: unknown;
}

export async function executeToolCommand(
  command: ToolCommand,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const server = createMcpServer();
  const client = new Client({ name: "jurisd-cli", version: "0.2.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    const result = await client.callTool({ name: command.tool, arguments: args });
    const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
    const text = content
      .filter((block) => block.type === "text" && block.text !== undefined)
      .map((block) => block.text)
      .join("\n");
    return { text: text ? `${text}\n` : "", isError: Boolean(result.isError), rawResult: result };
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
}
