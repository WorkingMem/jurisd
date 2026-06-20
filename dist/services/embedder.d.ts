/**
 * Local query embedding.
 *
 * Embeds a natural-language query into the same space the module chunks were
 * embedded in (bge-small-en-v1.5, 384-dim, L2-normalised) using transformers.js
 * (`@huggingface/transformers`) with its bundled tokeniser + onnxruntime-node
 * backend. The dependency ships by default but is lazy-imported with a
 * graceful-degrade safety net: if it is missing (e.g. an `--omit=optional`
 * install or a failed native build) or its model cannot be loaded, only
 * `semantic_search_local` is disabled, reported by the capability probe, and it
 * never throws into a tool result.
 *
 * The model is pinned by id + revision and cached under `~/.jurisd/models/`.
 * `JURISD_EMBED_OFFLINE=true` forbids any network reach and hard-fails (with a
 * clear, typed message) rather than downloading, for air-gapped installs.
 */
/** The pinned baseline embedding model (matches the module manifest descriptor). */
export declare const QUERY_MODEL_ID = "Xenova/bge-small-en-v1.5";
/** The model revision pin. */
export declare const QUERY_MODEL_REVISION = "main";
/** The embedding dimension of the baseline model. */
export declare const QUERY_MODEL_DIM = 384;
/** A function that embeds a query string into an L2-normalised Float32 vector. */
export type QueryEmbedder = (query: string) => Promise<Float32Array>;
/** The descriptor of the embedder actually in use (for the embedding-space gate). */
export interface EmbedderDescriptor {
    model_id: string;
    dim: number;
}
/** The descriptor of the baseline local embedder. */
export declare const BASELINE_EMBEDDER_DESCRIPTOR: EmbedderDescriptor;
/** The descriptor of the embedder a query will be embedded with. */
export declare function activeEmbedderDescriptor(): EmbedderDescriptor;
/** Thrown when offline mode is set but the model is not pre-seeded. */
export declare class EmbedOfflineError extends Error {
    constructor(message: string);
}
/** Whether the local embedder dependency is importable (capability probe). */
export declare function isEmbedderAvailable(): Promise<boolean>;
/**
 * Return the singleton query embedder, creating it on first use (never at
 * startup). Returns null when the dependency is absent. Throws
 * {@link EmbedOfflineError} only when offline mode is set and the model cannot
 * be loaded from the local cache.
 */
export declare function getQueryEmbedder(): Promise<QueryEmbedder | null>;
/** Reset embedder singleton state (test helper). */
export declare function resetEmbedder(): void;
/**
 * Inject a fake embedder for tests (so the cosine path can be exercised without
 * the optional native dependency). Pass null to clear. The descriptor advertises
 * the model_id/dim the embedding-space gate compares module descriptors against.
 */
export declare function setQueryEmbedderForTest(fn: QueryEmbedder | null, descriptor?: EmbedderDescriptor): void;
//# sourceMappingURL=embedder.d.ts.map