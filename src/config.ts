/**
 * Configuration module for jurisd
 * Loads configuration from environment variables with defaults
 */

import path from "node:path";

export interface Config {
  austlii: {
    searchBase: string;
    referer: string;
    userAgent: string;
    timeout: number;
    /**
     * Per-request transport override for AustLII fetches.
     * "auto" defers to transport.useImpit; "impit" forces TLS impersonation;
     * "axios" forces the plain HTTP path.
     */
    transport: "auto" | "impit" | "axios";
    /**
     * When true (default), AustLII document URLs are rewritten to the classic
     * hostname + direct document path before fetching.
     */
    classicRewrite: boolean;
    /**
     * Optional user-supplied `cf_clearance` cookie value, attached to AustLII
     * requests so an already-solved Cloudflare challenge can be reused.
     * Never logged or echoed in error messages.
     */
    cfClearance?: string;
    /** Accept header sent on AustLII requests. */
    accept: string;
    /** Accept-Language header sent on AustLII requests. */
    acceptLanguage: string;
  };
  exa: {
    /**
     * Exa API key (https://exa.ai). When set, Exa is used as a search-discovery
     * fallback for AustLII when the live site is Cloudflare-blocked. Exa returns
     * canonical austlii.edu.au case/legislation URLs.
     * Never logged or echoed in error messages.
     */
    apiKey?: string;
    /** Exa search type, for example "auto" (default), "fast", or "deep". */
    searchType: string;
    /** Max results requested from Exa per query. */
    maxResults: number;
    /** Request timeout in milliseconds. */
    timeout: number;
  };
  defaults: {
    searchLimit: number;
    maxSearchLimit: number;
    outputFormat: string;
    sortBy: string;
  };
  cache: {
    /** Base directory for the .auslaw/ cache folder. Defaults to cwd. */
    dir: string;
    /** Project name used in bib exports and multi-doc tracking. Defaults to basename of dir. */
    projectName: string;
  };
  sources: {
    /** Directory where source markdown files are saved. */
    dir: string;
    /** When true, fetch_document_text automatically saves a local source copy. */
    fetchByDefault: boolean;
  };
  transport: {
    /**
     * When true, use the impit HTTP client (TLS impersonation) for AustLII
     * requests instead of axios. Defaults to true.
     */
    useImpit: boolean;
    /**
     * Browser profile passed to impit for TLS fingerprint impersonation.
     * Supported values: "chrome", "firefox", "safari".
     */
    imitBrowser: string;
  };
  oalc: {
    /**
     * Path to the OALC corpus JSONL file used as a document-text fallback.
     * Defaults to ~/oalc-data/corpus_published.jsonl.
     * Set AUSLAW_OALC_SOURCE to override.
     */
    source: string;
    /**
     * When true, the OALC DuckDB layer is enabled and will be queried for
     * document text when live AustLII fetch fails.
     */
    enabled: boolean;
  };
  tavily: {
    /** API key for Tavily search fallback. Never logged or returned. */
    apiKey?: string;
    /** When true, use Tavily to discover AustLII URLs if native AustLII search is CF-blocked. */
    austliiFallbackEnabled: boolean;
    /** Tavily search depth used for fallback discovery. */
    searchDepth: "basic" | "advanced";
    /** Tavily request timeout in milliseconds. */
    timeout: number;
    /** Maximum Tavily candidates to inspect for primary-source AustLII URLs. */
    maxResults: number;
  };
  modules: {
    /** Root dir for installed data modules. Default ~/.jurisd/modules. */
    dir: string; // JURISD_MODULES_DIR
    /** When false, the whole local-module layer (Layer 1) is disabled. */
    enabled: boolean; // JURISD_MODULES_ENABLED, default true
    /** Staleness threshold in days for the snapshot advisory. */
    stalenessDays: number; // JURISD_MODULE_STALENESS_DAYS, default 365
    /** When true, sha256-verify each parquet against the manifest on load. */
    verifyOnLoad: boolean; // JURISD_MODULE_VERIFY_ON_LOAD, default false
    /** Directory the local embedder caches its model under. */
    modelsDir: string; // JURISD_MODELS_DIR, default ~/.jurisd/models
    /** When true, the embedder must never reach the network (air-gapped). */
    embedOffline: boolean; // JURISD_EMBED_OFFLINE, default false
  };
}

/**
 * Load configuration from environment variables with sensible defaults.
 *
 * @returns A fully-populated {@link Config} object
 */
export function loadConfig(): Config {
  const cacheDir = process.env.AUSLAW_CACHE_DIR ?? process.cwd();
  const projectName = process.env.AUSLAW_PROJECT_NAME ?? path.basename(cacheDir);
  const sourcesDir = process.env.AUSLAW_SOURCES_DIR ?? path.join(cacheDir, "sources");
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ".";

  return {
    austlii: {
      searchBase:
        process.env.AUSTLII_SEARCH_BASE || "https://www.austlii.edu.au/cgi-bin/sinosrch.cgi",
      referer: process.env.AUSTLII_REFERER || "https://www.austlii.edu.au/forms/search1.html",
      userAgent:
        process.env.AUSTLII_USER_AGENT ||
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      timeout: parseInt(process.env.AUSTLII_TIMEOUT || "60000", 10), // AustLII can be slow
      transport: ((): "auto" | "impit" | "axios" => {
        const t = process.env.AUSTLII_TRANSPORT;
        return t === "impit" || t === "axios" ? t : "auto";
      })(),
      classicRewrite: process.env.AUSTLII_CLASSIC_REWRITE !== "false",
      cfClearance: process.env.AUSTLII_CF_CLEARANCE || undefined,
      accept:
        process.env.AUSTLII_ACCEPT ||
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      acceptLanguage: process.env.AUSTLII_ACCEPT_LANGUAGE || "en-AU,en;q=0.9",
    },
    exa: {
      apiKey: process.env.EXA_API_KEY || undefined,
      searchType: process.env.EXA_SEARCH_TYPE || "auto",
      maxResults: parseInt(process.env.EXA_MAX_RESULTS || "10", 10) || 10,
      timeout: parseInt(process.env.EXA_TIMEOUT || "10000", 10) || 10000,
    },
    defaults: {
      searchLimit: parseInt(process.env.DEFAULT_SEARCH_LIMIT || "10", 10),
      maxSearchLimit: parseInt(process.env.MAX_SEARCH_LIMIT || "50", 10),
      outputFormat: process.env.DEFAULT_OUTPUT_FORMAT || "json",
      sortBy: process.env.DEFAULT_SORT_BY || "auto",
    },
    cache: {
      dir: cacheDir,
      projectName,
    },
    sources: {
      dir: sourcesDir,
      fetchByDefault: process.env.AUSLAW_FETCH_SOURCES !== "false",
    },
    transport: {
      useImpit: process.env.AUSLAW_USE_IMPIT !== "false",
      imitBrowser: process.env.AUSLAW_IMPIT_BROWSER || "chrome",
    },
    oalc: {
      source:
        process.env.AUSLAW_OALC_SOURCE ||
        `${process.env.HOME ?? process.env.USERPROFILE ?? "~"}/oalc-data/corpus_published.jsonl`,
      enabled: process.env.AUSLAW_OALC_ENABLED !== "false",
    },
    tavily: {
      apiKey: process.env.TAVILY_API_KEY || undefined,
      austliiFallbackEnabled: process.env.AUSTLII_TAVILY_FALLBACK === "true",
      searchDepth: process.env.TAVILY_SEARCH_DEPTH === "basic" ? "basic" : "advanced",
      timeout: parseInt(process.env.TAVILY_TIMEOUT || "20000", 10) || 20_000,
      maxResults: Math.min(
        Math.max(parseInt(process.env.TAVILY_MAX_RESULTS || "10", 10) || 10, 1),
        20,
      ),
    },
    modules: {
      dir: process.env.JURISD_MODULES_DIR || path.join(homeDir, ".jurisd", "modules"),
      enabled: process.env.JURISD_MODULES_ENABLED !== "false",
      stalenessDays: parseInt(process.env.JURISD_MODULE_STALENESS_DAYS || "365", 10) || 365,
      verifyOnLoad: process.env.JURISD_MODULE_VERIFY_ON_LOAD === "true",
      modelsDir: process.env.JURISD_MODELS_DIR || path.join(homeDir, ".jurisd", "models"),
      embedOffline: process.env.JURISD_EMBED_OFFLINE === "true",
    },
  };
}

// Export a singleton instance
export const config = loadConfig();
