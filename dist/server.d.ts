import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
/**
 * Build a fresh McpServer with all tools registered.
 *
 * Tool surface follows the tool-surface consolidation: 10 base tools, with
 * mode/op/action dispatch replacing the former one-tool-per-operation layout.
 *
 * In stateless HTTP mode (`sessionIdGenerator: undefined`), each request
 * requires its own server + transport instance because
 * `StreamableHTTPServerTransport` tracks per-request state on the Response
 * object. Reusing a single server/transport across requests throws
 * "Transport is already started" or silently corrupts the state machine.
 */
export declare function createMcpServer(): McpServer;
//# sourceMappingURL=server.d.ts.map