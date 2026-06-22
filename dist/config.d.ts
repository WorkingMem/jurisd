/**
 * Configuration module for jurisd
 * Loads configuration from environment variables with defaults
 */
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
    jade: {
        baseUrl: string;
        userAgent: string;
        timeout: number;
        sessionCookie?: string;
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
    citedBy: {
        /** Cache cited-by results from jade.io citator lookups. */
        enabled: boolean;
        /** Download source files for the top-N citing cases when caching cited-by results. */
        downloadSources: boolean;
        /** Maximum number of citing-case sources to download per lookup. */
        downloadLimit: number;
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
        dir: string;
        /** When false, the whole local-module layer (Layer 1) is disabled. */
        enabled: boolean;
        /** Staleness threshold in days for the snapshot advisory. */
        stalenessDays: number;
        /** When true, sha256-verify each parquet against the manifest on load. */
        verifyOnLoad: boolean;
        /** Directory the local embedder caches its model under. */
        modelsDir: string;
        /** When true, the embedder must never reach the network (air-gapped). */
        embedOffline: boolean;
    };
}
/**
 * Load configuration from environment variables with sensible defaults.
 *
 * @returns A fully-populated {@link Config} object
 */
export declare function loadConfig(): Config;
export declare const config: Config;
//# sourceMappingURL=config.d.ts.map