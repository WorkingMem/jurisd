/**
 * Startup capability probe.
 *
 * ROUTING.md mandates a startup capability probe; the data layer extends it with the
 * data-layer capabilities. The probe reports, WITHOUT changing routing
 * precedence:
 *
 *   - duckdb           — is @duckdb/node-api importable? (gates all five tools)
 *   - local_embeddings — is @huggingface/transformers importable? (gates
 *                        semantic_search_local)
 *   - modules          — count of ready vs refused modules
 *   - domain_adapter   — is a domain-specialised provider configured AND
 *                        reachable? (baseline otherwise)
 *
 * A missing capability disables only its feature, visibly. The result is what
 * list_data_modules and a future health/capabilities surface reads.
 */
import { type DomainAdapter } from "./adapter.js";
/** The result of the startup capability probe. */
export interface CapabilityProbe {
    duckdb: boolean;
    local_embeddings: boolean;
    modules: {
        ready: number;
        refused: number;
    };
    domain_adapter: {
        label: string;
        canRerank: boolean;
        canExtractiveQA: boolean;
        configured: boolean;
        reachable: boolean;
        detail?: string;
    };
}
/**
 * Run the capability probe. Each check degrades independently; a missing
 * optional dependency disables only its feature and is reported, never thrown.
 *
 * `reachabilityOverride` is forwarded to the adapter probe as a test seam.
 */
export declare function probeCapabilities(reachabilityOverride?: (cfg: {
    baseUrl: string;
}) => Promise<boolean>): Promise<CapabilityProbe>;
export declare function formatCapabilityProbeSummary(caps: CapabilityProbe): string;
/**
 * Return the domain adapter for query-time refinement, probing once and caching
 * the result for the process lifetime. Falls back to the baseline adapter when
 * no provider is configured or it is unreachable. Never throws.
 */
export declare function getActiveAdapter(): Promise<DomainAdapter>;
/** Reset the cached adapter probe (test helper). */
export declare function resetCapabilitiesCache(): void;
//# sourceMappingURL=capabilities.d.ts.map