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

import { isDuckDBAvailable, listModules } from "./modules.js";
import { isEmbedderAvailable } from "./embedder.js";
import {
  probeDomainAdapter,
  baselineAdapter,
  type AdapterProbe,
  type DomainAdapter,
} from "./adapter.js";

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
export async function probeCapabilities(
  reachabilityOverride?: (cfg: { baseUrl: string }) => Promise<boolean>,
): Promise<CapabilityProbe> {
  const [duckdb, localEmbeddings, adapterProbe] = await Promise.all([
    isDuckDBAvailable(),
    isEmbedderAvailable(),
    probeDomainAdapter(reachabilityOverride),
  ]);

  const mods = listModules();
  const ready = mods.filter((m) => m.status === "ready").length;
  const refused = mods.length - ready;

  const adapter: DomainAdapter = adapterProbe.adapter;
  return {
    duckdb,
    local_embeddings: localEmbeddings,
    modules: { ready, refused },
    domain_adapter: {
      label: adapter.label,
      canRerank: adapter.canRerank,
      canExtractiveQA: adapter.canExtractiveQA,
      configured: adapterProbe.configured,
      reachable: adapterProbe.reachable,
      detail: adapterProbe.detail,
    },
  };
}

let _cachedAdapterProbe: AdapterProbe | null = null;

/**
 * Return the domain adapter for query-time refinement, probing once and caching
 * the result for the process lifetime. Falls back to the baseline adapter when
 * no provider is configured or it is unreachable. Never throws.
 */
export async function getActiveAdapter(): Promise<DomainAdapter> {
  if (!_cachedAdapterProbe) {
    try {
      _cachedAdapterProbe = await probeDomainAdapter();
    } catch {
      return baselineAdapter;
    }
  }
  return _cachedAdapterProbe.adapter;
}

/** Reset the cached adapter probe (test helper). */
export function resetCapabilitiesCache(): void {
  _cachedAdapterProbe = null;
}
