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
import { config } from "../config.js";
/** The pinned baseline embedding model (matches the module manifest descriptor). */
export const QUERY_MODEL_ID = "Xenova/bge-small-en-v1.5";
/** The model revision pin. */
export const QUERY_MODEL_REVISION = "main";
/** The embedding dimension of the baseline model. */
export const QUERY_MODEL_DIM = 384;
/** The descriptor of the baseline local embedder. */
export const BASELINE_EMBEDDER_DESCRIPTOR = {
    model_id: QUERY_MODEL_ID,
    dim: QUERY_MODEL_DIM,
};
let _descriptor = BASELINE_EMBEDDER_DESCRIPTOR;
/** The descriptor of the embedder a query will be embedded with. */
export function activeEmbedderDescriptor() {
    return _descriptor;
}
/** Thrown when offline mode is set but the model is not pre-seeded. */
export class EmbedOfflineError extends Error {
    constructor(message) {
        super(message);
        this.name = "EmbedOfflineError";
    }
}
let _embedder = null;
let _embedderUnavailable = false;
/**
 * Lazily load `@huggingface/transformers`. Returns null when not installed,
 * matching the optional-dependency posture of the rest of the data layer.
 */
async function tryLoadTransformers() {
    if (_embedderUnavailable)
        return null;
    try {
        // The package name is held in a variable so the bundler/tsc does not try to
        // resolve the optional dependency at build time.
        const pkg = "@huggingface/transformers";
        return (await import(/* @vite-ignore */ pkg));
    }
    catch (err) {
        if (err instanceof Error &&
            "code" in err &&
            err.code === "ERR_MODULE_NOT_FOUND") {
            _embedderUnavailable = true;
            console.warn("[embedder] @huggingface/transformers is not installed. semantic_search_local is disabled. " +
                "Use a persistent local/global install for optional native dependencies; see " +
                "https://github.com/russellbrenner/jurisd/blob/main/docs/INSTALL.md#optional-native-dependencies");
            return null;
        }
        throw err;
    }
}
/** Whether the local embedder dependency is importable (capability probe). */
export async function isEmbedderAvailable() {
    return (await tryLoadTransformers()) !== null;
}
/**
 * Return the singleton query embedder, creating it on first use (never at
 * startup). Returns null when the dependency is absent. Throws
 * {@link EmbedOfflineError} only when offline mode is set and the model cannot
 * be loaded from the local cache.
 */
export async function getQueryEmbedder() {
    if (_embedder)
        return _embedder;
    const transformers = await tryLoadTransformers();
    if (!transformers)
        return null;
    // Cache + offline wiring. In offline mode we forbid remote model fetches.
    transformers.env.cacheDir = config.modules.modelsDir;
    transformers.env.localModelPath = config.modules.modelsDir;
    if (config.modules.embedOffline) {
        transformers.env.allowRemoteModels = false;
    }
    let extract;
    try {
        extract = await transformers.pipeline("feature-extraction", QUERY_MODEL_ID, {
            revision: QUERY_MODEL_REVISION,
        });
    }
    catch (err) {
        if (config.modules.embedOffline) {
            throw new EmbedOfflineError(`JURISD_EMBED_OFFLINE is set but the embedding model could not be loaded from ` +
                `${config.modules.modelsDir}. Pre-seed the model dir, e.g. run once online to cache ` +
                `${QUERY_MODEL_ID}. Original error: ${err.message}`);
        }
        // Honour the never-throw contract: a model-load failure (corrupt cache or an
        // incompatible native build) disables semantic_search_local rather than
        // throwing into a tool result. The probe reports it; the cause is logged.
        _embedderUnavailable = true;
        console.warn(`[embedder] failed to load ${QUERY_MODEL_ID} from ${config.modules.modelsDir}; ` +
            `semantic_search_local disabled. Delete the cached model and re-run online to ` +
            `re-fetch it. Original error: ${err.message}`);
        return null;
    }
    _embedder = async (query) => {
        const output = await extract(query, { pooling: "mean", normalize: true });
        return output.data instanceof Float32Array
            ? output.data
            : Float32Array.from(output.data);
    };
    return _embedder;
}
/** Reset embedder singleton state (test helper). */
export function resetEmbedder() {
    _embedder = null;
    _embedderUnavailable = false;
    _descriptor = BASELINE_EMBEDDER_DESCRIPTOR;
}
/**
 * Inject a fake embedder for tests (so the cosine path can be exercised without
 * the optional native dependency). Pass null to clear. The descriptor advertises
 * the model_id/dim the embedding-space gate compares module descriptors against.
 */
export function setQueryEmbedderForTest(fn, descriptor) {
    _embedder = fn;
    _embedderUnavailable = false;
    _descriptor = descriptor ?? BASELINE_EMBEDDER_DESCRIPTOR;
}
//# sourceMappingURL=embedder.js.map