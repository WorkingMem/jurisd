/**
 * AusLaw MCP - Shared constants
 * Copyright (c) 2024 Russell Brenner
 * Licensed under the MIT License
 *
 * Central location for magic strings / numbers used across the codebase.
 */

/** Regular expression for neutral citations, e.g. `[2024] HCA 26` */
export const NEUTRAL_CITATION_PATTERN = /\[(\d{4})\]\s*([A-Z]+)\s*(\d+)/;

/** Regular expressions for reported citations */
export const REPORTED_CITATION_PATTERNS = [
  /\((\d{4})\)\s+(\d+)\s+([A-Z]{2,6})\s+(\d+)/, // (2024) 350 ALR 123
  /\[(\d{4})\]\s+(\d+)\s+([A-Z]{2,6})\s+(\d+)/, // [2024] 1 NZLR 456
] as const;

/** Search method identifiers understood by AustLII. */
export const SEARCH_METHODS = {
  AUTO: "auto",
  TITLE: "title",
  PHRASE: "phrase",
  ALL: "all",
  ANY: "any",
  NEAR: "near",
  LEGIS: "legis",
  BOOLEAN: "boolean",
} as const;

/** Jurisdiction short-codes. */
export const JURISDICTIONS = {
  COMMONWEALTH: "cth",
  FEDERAL: "federal",
  VICTORIA: "vic",
  NEW_SOUTH_WALES: "nsw",
  QUEENSLAND: "qld",
  SOUTH_AUSTRALIA: "sa",
  WESTERN_AUSTRALIA: "wa",
  TASMANIA: "tas",
  NORTHERN_TERRITORY: "nt",
  AUSTRALIAN_CAPITAL_TERRITORY: "act",
  NEW_ZEALAND: "nz",
} as const;

/** Minimum text length before OCR fallback is triggered */
export const OCR_MIN_TEXT_LENGTH = 100;

/** Default HTTP timeout in milliseconds */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Extended timeout for slow endpoints */
export const LONG_TIMEOUT_MS = 60_000;

/** Maximum document size we will attempt to download (50 MB) */
export const MAX_CONTENT_LENGTH = 50 * 1024 * 1024;

/** Maximum number of removed.invalid articles to resolve concurrently during search */
export const MAX_RESOLUTIONS = 5;
