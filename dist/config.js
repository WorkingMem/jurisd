/**
 * Configuration module for jurisd
 * Loads configuration from environment variables with defaults
 */
import path from "node:path";
/**
 * Load configuration from environment variables with sensible defaults.
 *
 * @returns A fully-populated {@link Config} object
 */
export function loadConfig() {
    const cacheDir = process.env.AUSLAW_CACHE_DIR ?? process.cwd();
    const projectName = process.env.AUSLAW_PROJECT_NAME ?? path.basename(cacheDir);
    const sourcesDir = process.env.AUSLAW_SOURCES_DIR ?? path.join(cacheDir, "sources");
    const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ".";
    return {
        austlii: {
            searchBase: process.env.AUSTLII_SEARCH_BASE || "https://www.austlii.edu.au/cgi-bin/sinosrch.cgi",
            referer: process.env.AUSTLII_REFERER || "https://www.austlii.edu.au/forms/search1.html",
            userAgent: process.env.AUSTLII_USER_AGENT ||
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            timeout: parseInt(process.env.AUSTLII_TIMEOUT || "60000", 10), // AustLII can be slow
            transport: (() => {
                const t = process.env.AUSTLII_TRANSPORT;
                return t === "impit" || t === "axios" ? t : "auto";
            })(),
            classicRewrite: process.env.AUSTLII_CLASSIC_REWRITE !== "false",
            cfClearance: process.env.AUSTLII_CF_CLEARANCE || undefined,
            accept: process.env.AUSTLII_ACCEPT ||
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            acceptLanguage: process.env.AUSTLII_ACCEPT_LANGUAGE || "en-AU,en;q=0.9",
        },
        jade: {
            baseUrl: process.env.JADE_BASE_URL || "https://jade.io",
            userAgent: process.env.JADE_USER_AGENT || "jurisd/0.1.0 (legal research tool)",
            timeout: parseInt(process.env.JADE_TIMEOUT || "15000", 10),
            sessionCookie: process.env.JADE_SESSION_COOKIE || undefined,
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
        citedBy: {
            enabled: process.env.AUSLAW_CACHE_CITED_BY !== "false",
            downloadSources: process.env.AUSLAW_DOWNLOAD_CITED_BY_SOURCES !== "false",
            downloadLimit: parseInt(process.env.AUSLAW_CITED_BY_DOWNLOAD_LIMIT ?? "5", 10) || 5,
        },
        transport: {
            useImpit: process.env.AUSLAW_USE_IMPIT !== "false",
            imitBrowser: process.env.AUSLAW_IMPIT_BROWSER || "chrome",
        },
        oalc: {
            source: process.env.AUSLAW_OALC_SOURCE ||
                `${process.env.HOME ?? process.env.USERPROFILE ?? "~"}/oalc-data/corpus_published.jsonl`,
            enabled: process.env.AUSLAW_OALC_ENABLED !== "false",
        },
        tavily: {
            apiKey: process.env.TAVILY_API_KEY || undefined,
            austliiFallbackEnabled: process.env.AUSTLII_TAVILY_FALLBACK === "true",
            searchDepth: process.env.TAVILY_SEARCH_DEPTH === "basic" ? "basic" : "advanced",
            timeout: parseInt(process.env.TAVILY_TIMEOUT || "20000", 10) || 20_000,
            maxResults: Math.min(Math.max(parseInt(process.env.TAVILY_MAX_RESULTS || "10", 10) || 10, 1), 20),
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
//# sourceMappingURL=config.js.map