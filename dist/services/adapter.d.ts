/**
 * Vendor-neutral provider adapter.
 *
 * The semantic path has two OPTIONAL enhancement slots that operate over the
 * top-k LOCAL results and never replace local recall:
 *
 *   - rerank        — reorder the locally-retrieved top-k by a stronger model
 *   - extractiveQA  — return the best answer span within a LOCAL chunk
 *
 * Both are expressed through one vendor-neutral interface so no vendor name
 * leaks into the core. There are two adapters:
 *
 *   - the baseline adapter (always present): no rerank, no EQA, label "baseline"
 *   - a domain-specialised adapter (slot): selected IFF a provider is configured
 *     AND reachable. The label is provider-interpolated, e.g. "Isaacus-enhanced".
 *
 * Framing rule (binding): described only as baseline vs domain-specialised with
 * a provider-interpolated label. Never "free vs premium" / "basic vs pro".
 * Absence degrades silently to baseline; a reachability failure is logged once
 * and reported by the probe, never thrown into a tool result.
 */
/** A locally-retrieved chunk, the unit the adapter refines (never fetches new). */
export interface LocalChunk {
    chunk_id: string;
    text: string;
    score: number;
    [extra: string]: unknown;
}
/** The vendor-neutral domain adapter interface. */
export interface DomainAdapter {
    /** Vendor-neutral capability flags. */
    canRerank: boolean;
    canExtractiveQA: boolean;
    /** Provider-interpolated display label, e.g. "Isaacus-enhanced" or "baseline". */
    label: string;
    /** Reorder local top-k. Input + output are LOCAL chunks; never fetches new docs. */
    rerank?(query: string, chunks: LocalChunk[]): Promise<LocalChunk[]>;
    /** Extract an answer span from a LOCAL chunk. */
    extractiveQA?(query: string, chunk: LocalChunk): Promise<{
        span: string;
        start: number;
        end: number;
    } | null>;
}
/** The always-present baseline adapter: pure local cosine order, no network. */
export declare const baselineAdapter: DomainAdapter;
/** Probe outcome for the domain adapter slot. */
export interface AdapterProbe {
    adapter: DomainAdapter;
    /** True when a provider was configured (key present), regardless of reachability. */
    configured: boolean;
    /** True when the configured provider was reachable at probe time. */
    reachable: boolean;
    /** A single human-readable reason when configured-but-unreachable. */
    detail?: string;
}
interface IsaacusConfig {
    apiKey: string;
    baseUrl: string;
}
/** Read the Isaacus BYOK config from the environment, or null when unset. */
export declare function readIsaacusConfig(): IsaacusConfig | null;
/**
 * Build the Isaacus domain adapter from a config. The rerank/EQA methods are
 * skeletons that call the runtime and fall back to a no-op on any error, so the
 * tool result is never corrupted by a provider failure (silent degradation to
 * the local ordering for that single call).
 */
export declare function buildIsaacusAdapter(cfg: IsaacusConfig): DomainAdapter;
/**
 * Probe the domain adapter slot. Selects the Isaacus adapter iff configured and
 * reachable; otherwise returns the baseline adapter. A configured-but-unreachable
 * provider is logged exactly once and reported via the probe, never thrown.
 *
 * `reachabilityOverride` is a test seam to avoid a live network call.
 */
export declare function probeDomainAdapter(reachabilityOverride?: (cfg: {
    baseUrl: string;
}) => Promise<boolean>): Promise<AdapterProbe>;
/** Reset the once-only unreachable log (test helper). */
export declare function resetAdapterState(): void;
export {};
//# sourceMappingURL=adapter.d.ts.map