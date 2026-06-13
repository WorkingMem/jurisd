/**
 * Local query embedding.
 *
 * Embeds a natural-language query into the same space the module chunks were
 * embedded in (bge-small-en-v1.5, 384-dim, L2-normalised) using transformers.js
 * (`@huggingface/transformers`) with its bundled tokeniser + onnxruntime-node
 * backend. The dependency is OPTIONAL and lazy-imported with the same
 * graceful-degrade pattern as oalc.ts and the module loader: its absence
 * disables only `semantic_search_local`, reported by the capability probe, and
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

/** A function that embeds a query string into an L2-normalised Float32 vector. */
export type QueryEmbedder = (query: string) => Promise<Float32Array>;

/** The descriptor of the embedder actually in use (for the embedding-space gate). */
export interface EmbedderDescriptor {
  model_id: string;
  dim: number;
}

/** The descriptor of the baseline local embedder. */
export const BASELINE_EMBEDDER_DESCRIPTOR: EmbedderDescriptor = {
  model_id: QUERY_MODEL_ID,
  dim: QUERY_MODEL_DIM,
};

let _descriptor: EmbedderDescriptor = BASELINE_EMBEDDER_DESCRIPTOR;

/** The descriptor of the embedder a query will be embedded with. */
export function activeEmbedderDescriptor(): EmbedderDescriptor {
  return _descriptor;
}

/** Thrown when offline mode is set but the model is not pre-seeded. */
export class EmbedOfflineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbedOfflineError";
  }
}

let _embedder: QueryEmbedder | null = null;
let _embedderUnavailable = false;

/** Minimal shape of the transformers.js pipeline we depend on. */
type FeatureExtractionPipeline = (
  text: string,
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array | number[] }>;

interface TransformersModule {
  pipeline: (
    task: "feature-extraction",
    model: string,
    opts?: { revision?: string },
  ) => Promise<FeatureExtractionPipeline>;
  env: {
    allowRemoteModels: boolean;
    localModelPath?: string;
    cacheDir?: string;
  };
}

/**
 * Lazily load `@huggingface/transformers`. Returns null when not installed,
 * matching the optional-dependency posture of the rest of the data layer.
 */
async function tryLoadTransformers(): Promise<TransformersModule | null> {
  if (_embedderUnavailable) return null;
  try {
    // The package name is held in a variable so the bundler/tsc does not try to
    // resolve the optional dependency at build time.
    const pkg = "@huggingface/transformers";
    return (await import(/* @vite-ignore */ pkg)) as unknown as TransformersModule;
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND"
    ) {
      _embedderUnavailable = true;
      console.warn(
        "[embedder] @huggingface/transformers is not installed. semantic_search_local is disabled. " +
          "Run: npm install @huggingface/transformers",
      );
      return null;
    }
    throw err;
  }
}

/** Whether the local embedder dependency is importable (capability probe). */
export async function isEmbedderAvailable(): Promise<boolean> {
  return (await tryLoadTransformers()) !== null;
}

/**
 * Return the singleton query embedder, creating it on first use (never at
 * startup). Returns null when the dependency is absent. Throws
 * {@link EmbedOfflineError} only when offline mode is set and the model cannot
 * be loaded from the local cache.
 */
export async function getQueryEmbedder(): Promise<QueryEmbedder | null> {
  if (_embedder) return _embedder;

  const transformers = await tryLoadTransformers();
  if (!transformers) return null;

  // Cache + offline wiring. In offline mode we forbid remote model fetches.
  transformers.env.cacheDir = config.modules.modelsDir;
  transformers.env.localModelPath = config.modules.modelsDir;
  if (config.modules.embedOffline) {
    transformers.env.allowRemoteModels = false;
  }

  let extract: FeatureExtractionPipeline;
  try {
    extract = await transformers.pipeline("feature-extraction", QUERY_MODEL_ID, {
      revision: QUERY_MODEL_REVISION,
    });
  } catch (err) {
    if (config.modules.embedOffline) {
      throw new EmbedOfflineError(
        `JURISD_EMBED_OFFLINE is set but the embedding model could not be loaded from ` +
          `${config.modules.modelsDir}. Pre-seed the model dir, e.g. run once online to cache ` +
          `${QUERY_MODEL_ID}. Original error: ${(err as Error).message}`,
      );
    }
    throw err;
  }

  _embedder = async (query: string): Promise<Float32Array> => {
    const output = await extract(query, { pooling: "mean", normalize: true });
    return output.data instanceof Float32Array
      ? output.data
      : Float32Array.from(output.data as number[]);
  };
  return _embedder;
}

/** Reset embedder singleton state (test helper). */
export function resetEmbedder(): void {
  _embedder = null;
  _embedderUnavailable = false;
  _descriptor = BASELINE_EMBEDDER_DESCRIPTOR;
}

/**
 * Inject a fake embedder for tests (so the cosine path can be exercised without
 * the optional native dependency). Pass null to clear. The descriptor advertises
 * the model_id/dim the embedding-space gate compares module descriptors against.
 */
export function setQueryEmbedderForTest(
  fn: QueryEmbedder | null,
  descriptor?: EmbedderDescriptor,
): void {
  _embedder = fn;
  _embedderUnavailable = false;
  _descriptor = descriptor ?? BASELINE_EMBEDDER_DESCRIPTOR;
}
