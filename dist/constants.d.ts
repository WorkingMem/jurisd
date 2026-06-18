/**
 * jurisd - Shared constants
 * Copyright (c) 2024 Russell Brenner
 * Licensed under the MIT License
 *
 * Central location for magic strings / numbers used across the codebase.
 */
/** Regular expression for neutral citations, e.g. `[2024] HCA 26` */
export declare const NEUTRAL_CITATION_PATTERN: RegExp;
/** Regular expressions for reported citations */
export declare const REPORTED_CITATION_PATTERNS: readonly [RegExp, RegExp];
export declare const REPORTERS: Record<string, string>;
export declare const COURT_TO_AUSTLII_PATH: Record<string, string>;
/** Search method identifiers understood by AustLII. */
export declare const SEARCH_METHODS: {
    readonly AUTO: "auto";
    readonly TITLE: "title";
    readonly PHRASE: "phrase";
    readonly ALL: "all";
    readonly ANY: "any";
    readonly NEAR: "near";
    readonly LEGIS: "legis";
    readonly BOOLEAN: "boolean";
};
/** Jurisdiction short-codes. */
export declare const JURISDICTIONS: {
    readonly COMMONWEALTH: "cth";
    readonly FEDERAL: "federal";
    readonly VICTORIA: "vic";
    readonly NEW_SOUTH_WALES: "nsw";
    readonly QUEENSLAND: "qld";
    readonly SOUTH_AUSTRALIA: "sa";
    readonly WESTERN_AUSTRALIA: "wa";
    readonly TASMANIA: "tas";
    readonly NORTHERN_TERRITORY: "nt";
    readonly AUSTRALIAN_CAPITAL_TERRITORY: "act";
    readonly NEW_ZEALAND: "nz";
};
/** Default HTTP timeout in milliseconds */
export declare const DEFAULT_TIMEOUT_MS = 30000;
/** Extended timeout for slow endpoints */
export declare const LONG_TIMEOUT_MS = 60000;
/**
 * Maximum document size we will attempt to download (10 MB).
 *
 * Legal documents (HTML/PDF) are well under this; a smaller cap bounds the
 * CPU/memory a single hostile or oversized response can cost during cheerio DOM
 * construction + per-node parsing (DoS hardening).
 */
export declare const MAX_CONTENT_LENGTH: number;
/** Maximum number of jade.io articles to resolve concurrently during search */
export declare const MAX_JADE_RESOLUTIONS = 5;
/** Version of the local citation cache schema — increment on breaking changes */
export declare const AUSLAW_CACHE_VERSION = 1;
/** Subdirectory name for the local cache within the project directory */
export declare const AUSLAW_CACHE_DIR_NAME = ".auslaw";
//# sourceMappingURL=constants.d.ts.map