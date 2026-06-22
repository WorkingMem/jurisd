export type OutputMode = "human" | "json" | "ndjson" | "plain" | "markdown";
export type SideEffectClass = "read_only_query" | "local_metadata_read" | "network_read" | "credential_dependent_read" | "corpus_write" | "graph_write" | "review_state_write" | "export_write" | "filesystem_write" | "network_write" | "destructive_admin";
export type Stability = "stable" | "experimental" | "future";
export interface CommandArgumentContract {
    name: string;
    required: boolean;
    summary: string;
}
export interface CommandFlagContract {
    name: string;
    type: "string" | "number" | "boolean" | "array";
    summary: string;
    values?: string[];
}
export interface CliAdapterContract {
    enabled: boolean;
    canonicalName?: string;
    aliases: string[];
    positional: string[];
    numeric: string[];
    boolean: string[];
    array: string[];
    group: string;
}
export interface McpAdapterContract {
    enabled: boolean;
    toolName?: string;
}
export interface TuiAdapterContract {
    enabled: boolean;
    label?: string;
    networkPolicy?: "none" | "accepted_safe_default";
    authorityNote?: string;
}
export interface CommandContract {
    id: string;
    synopsis: string;
    summary: string;
    description: string;
    stability: Stability;
    sideEffectClass: SideEffectClass;
    dangerous: boolean;
    requiresConfirmation: boolean;
    stdinMode: "none" | "json" | "ndjson" | "text";
    outputModes: OutputMode[];
    exitCodes: number[];
    resultContract: string;
    capabilityGates: string[];
    arguments: CommandArgumentContract[];
    flags: CommandFlagContract[];
    examples: string[];
    adapters: {
        cli: CliAdapterContract;
        mcp: McpAdapterContract;
        tui: TuiAdapterContract;
    };
}
//# sourceMappingURL=types.d.ts.map