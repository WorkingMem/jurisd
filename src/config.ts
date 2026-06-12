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
  jade: {
    baseUrl: string;
    userAgent: string;
    timeout: number;
    sessionCookie?: string;
  };
  ocr: {
    language: string;
    oem: number;
    psm: number;
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
     * requests instead of axios. Requires the optional 'impit' dependency.
     * Defaults to true when impit is installed.
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
    jade: {
      baseUrl: process.env.JADE_BASE_URL || "https://jade.io",
      userAgent: process.env.JADE_USER_AGENT || "jurisd/0.1.0 (legal research tool)",
      timeout: parseInt(process.env.JADE_TIMEOUT || "15000", 10),
      sessionCookie: process.env.JADE_SESSION_COOKIE || undefined,
    },
    ocr: {
      language: process.env.OCR_LANGUAGE || "eng",
      oem: parseInt(process.env.OCR_OEM || "1", 10),
      psm: parseInt(process.env.OCR_PSM || "3", 10),
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
      source:
        process.env.AUSLAW_OALC_SOURCE ||
        `${process.env.HOME ?? process.env.USERPROFILE ?? "~"}/oalc-data/corpus_published.jsonl`,
      enabled: process.env.AUSLAW_OALC_ENABLED !== "false",
    },
  };
}

// Export a singleton instance
export const config = loadConfig();
