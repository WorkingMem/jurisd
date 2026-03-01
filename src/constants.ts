/**
 * AusLaw MCP - Shared constants
 * Copyright (c) 2024 Russell Brenner
 * Licensed under the MIT License
 *
 * Central location for magic strings / numbers used across the codebase.
 */

/** Regular expression for neutral citations, e.g. `[2024] HCA 26` */
export const NEUTRAL_CITATION_PATTERN = /\[(\d{4})\]\s*([A-Za-z0-9]+)\s*(\d+)/;

/** Regular expressions for reported citations */
export const REPORTED_CITATION_PATTERNS = [
  /\((\d{4})\)\s+(\d+)\s+([A-Z]{2,6})\s+(\d+)/, // (2024) 350 ALR 123
  /\[(\d{4})\]\s+(\d+)\s+([A-Z]{2,6})\s+(\d+)/, // [2024] 1 NZLR 456
] as const;

export const REPORTERS: Record<string, string> = {
  CLR: "Commonwealth Law Reports",
  ALR: "Australian Law Reports",
  ALJR: "Australian Law Journal Reports",
  FCR: "Federal Court Reports",
  FLR: "Federal Law Reports",
  FamLR: "Family Law Reports",
  FLC: "Family Law Cases",
  NSWLR: "New South Wales Law Reports",
  VR: "Victorian Reports",
  QdR: "Queensland Reports",
  SASR: "South Australian State Reports",
  WAR: "Western Australian Reports",
  NZLR: "New Zealand Law Reports",
  NZFLR: "New Zealand Family Law Reports",
};

export const COURT_TO_AUSTLII_PATH: Record<string, string> = {
  HCA: "au/cases/cth/HCA",
  FCAFC: "au/cases/cth/FCAFC",
  FCA: "au/cases/cth/FCA",
  FedCFamC1F: "au/cases/cth/FedCFamC1F",
  FedCFamC2F: "au/cases/cth/FedCFamC2F",
  NSWSC: "au/cases/nsw/NSWSC",
  NSWCA: "au/cases/nsw/NSWCA",
  NSWCCA: "au/cases/nsw/NSWCCA",
  VSC: "au/cases/vic/VSC",
  VSCA: "au/cases/vic/VSCA",
  QSC: "au/cases/qld/QSC",
  QCA: "au/cases/qld/QCA",
  SASC: "au/cases/sa/SASC",
  WASC: "au/cases/wa/WASC",
  TASSC: "au/cases/tas/TASSC",
  NTSC: "au/cases/nt/NTSC",
  ACTSC: "au/cases/act/ACTSC",
  NZHC: "nz/cases/NZHC",
  NZCA: "nz/cases/NZCA",
  NZSC: "nz/cases/NZSC",
};

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
