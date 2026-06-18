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
/** The always-present baseline adapter: pure local cosine order, no network. */
export const baselineAdapter = {
    canRerank: false,
    canExtractiveQA: false,
    label: "baseline",
};
/**
 * The Isaacus runtime adapter skeleton (BYOK).
 *
 * Configured via `ISAACUS_API_KEY` (+ optional `ISAACUS_BASE_URL`). When the key
 * is present and the endpoint is reachable, the probe selects this adapter with
 * a provider-interpolated label and the rerank + extractive-QA slots wired to
 * the runtime. The actual HTTP calls are left as a skeleton: the slots are
 * present and typed, the wiring (auth header, request shape) is sketched, and
 * any failure degrades to returning the input unchanged (rerank) or null (EQA)
 * so a provider hiccup never corrupts a tool result.
 */
const ISAACUS_LABEL = "Isaacus-enhanced";
/** Read the Isaacus BYOK config from the environment, or null when unset. */
export function readIsaacusConfig() {
    const apiKey = process.env.ISAACUS_API_KEY;
    if (!apiKey)
        return null;
    return {
        apiKey,
        baseUrl: process.env.ISAACUS_BASE_URL || "https://api.isaacus.com/v1",
    };
}
/**
 * Build the Isaacus domain adapter from a config. The rerank/EQA methods are
 * skeletons that call the runtime and fall back to a no-op on any error, so the
 * tool result is never corrupted by a provider failure (silent degradation to
 * the local ordering for that single call).
 */
export function buildIsaacusAdapter(cfg) {
    return {
        canRerank: true,
        canExtractiveQA: true,
        label: ISAACUS_LABEL,
        async rerank(query, chunks) {
            try {
                const res = await fetch(`${cfg.baseUrl}/rerankings`, {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        authorization: `Bearer ${cfg.apiKey}`,
                    },
                    body: JSON.stringify({
                        query,
                        texts: chunks.map((c) => c.text),
                    }),
                });
                if (!res.ok)
                    return chunks;
                const body = (await res.json());
                if (!body.results)
                    return chunks;
                // Reorder the LOCAL chunks by the provider's result order; never fetch.
                return body.results
                    .filter((r) => r.index >= 0 && r.index < chunks.length)
                    .map((r) => ({ ...chunks[r.index], rerank_score: r.score }));
            }
            catch {
                // Silent degradation for this single call — keep local order.
                return chunks;
            }
        },
        async extractiveQA(query, chunk) {
            try {
                const res = await fetch(`${cfg.baseUrl}/extractions/qa`, {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        authorization: `Bearer ${cfg.apiKey}`,
                    },
                    body: JSON.stringify({ query, texts: [chunk.text] }),
                });
                if (!res.ok)
                    return null;
                const body = (await res.json());
                const first = body.results?.[0];
                if (!first)
                    return null;
                return { span: first.text, start: first.start, end: first.end };
            }
            catch {
                return null;
            }
        },
    };
}
/** A reachability check that never throws; returns false on any failure. */
async function isReachable(cfg) {
    try {
        // A lightweight HEAD/GET on the base URL; any 2xx/4xx response (i.e. the
        // host answered) counts as reachable. A network error / timeout does not.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        try {
            const res = await fetch(cfg.baseUrl, {
                method: "GET",
                headers: { authorization: `Bearer ${cfg.apiKey}` },
                signal: controller.signal,
            });
            return res.status > 0;
        }
        finally {
            clearTimeout(timer);
        }
    }
    catch {
        return false;
    }
}
let _loggedUnreachable = false;
/**
 * Probe the domain adapter slot. Selects the Isaacus adapter iff configured and
 * reachable; otherwise returns the baseline adapter. A configured-but-unreachable
 * provider is logged exactly once and reported via the probe, never thrown.
 *
 * `reachabilityOverride` is a test seam to avoid a live network call.
 */
export async function probeDomainAdapter(reachabilityOverride) {
    const cfg = readIsaacusConfig();
    if (!cfg) {
        return { adapter: baselineAdapter, configured: false, reachable: false };
    }
    const reachable = reachabilityOverride ? await reachabilityOverride(cfg) : await isReachable(cfg);
    if (!reachable) {
        if (!_loggedUnreachable) {
            _loggedUnreachable = true;
            console.warn("[adapter] a domain provider is configured but was not reachable at probe time; " +
                "using the baseline adapter (local cosine order).");
        }
        return {
            adapter: baselineAdapter,
            configured: true,
            reachable: false,
            detail: "provider configured but unreachable",
        };
    }
    return { adapter: buildIsaacusAdapter(cfg), configured: true, reachable: true };
}
/** Reset the once-only unreachable log (test helper). */
export function resetAdapterState() {
    _loggedUnreachable = false;
}
//# sourceMappingURL=adapter.js.map