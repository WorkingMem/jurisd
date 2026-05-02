/**
 * AusLaw MCP - Citation service
 * Copyright (c) 2024 Russell Brenner
 * Licensed under the MIT License
 *
 * AGLC4-compliant citation parsing, formatting, validation, and normalisation.
 */

import axios from "axios";
import {
  NEUTRAL_CITATION_PATTERN,
  REPORTED_CITATION_PATTERNS,
  COURT_TO_AUSTLII_PATH,
  REPORTERS,
} from "../constants.js";
import type { ParagraphBlock } from "./fetcher.js";

export interface ParsedCitation {
  neutralCitation?: string;
  reportedCitations: string[];
  pinpoint?: string;
}

export interface AGLC4FormatInput {
  title: string;
  neutralCitation?: string;
  reportedCitation?: string;
  /** Free-form pinpoint string, e.g. "[20]", "401", "[64] to [66]". */
  pinpoint?: string;
}

export interface CitationValidationResult {
  valid: boolean;
  canonicalCitation?: string;
  austliiUrl?: string;
  message?: string;
}

/**
 * Structured pinpoint reference for AGLC4 citations.
 *
 * Use `formatPinpointRef` to convert to the correct AGLC4 string fragment.
 */
export type Pinpoint =
  | { type: "para"; n: number } // at [20]
  | { type: "page"; n: number } // at 401
  | { type: "paraRange"; from: number; to: number } // at [64] to [66]
  | { type: "pageRange"; from: number; to: number } // at 401 to 407
  | { type: "legis"; ref: string }; // s 5(2)(a)  reg 12  sch 1

/** Convert a structured Pinpoint to the AGLC4 string fragment (without leading "at"). */
export function formatPinpointRef(p: Pinpoint): string {
  switch (p.type) {
    case "para":
      return `[${p.n}]`;
    case "page":
      return String(p.n);
    case "paraRange":
      return `[${p.from}] to [${p.to}]`;
    case "pageRange":
      return `${p.from} to ${p.to}`;
    case "legis":
      return p.ref;
  }
}

/** Input to `formatShortForm`. */
export interface ShortFormInput {
  /** The abbreviated case name chosen at first reference. */
  title: string;
  pinpoint?: Pinpoint;
  /** "short" = plain short form, "ibid" = Ibid, "subsequent" = title (n X). */
  mode: "short" | "ibid" | "subsequent";
  /** Footnote number of the first citation — required for "subsequent" mode. */
  footnoteRef?: number;
}

/**
 * Format an AGLC4-compliant short-form, Ibid, or subsequent reference.
 *
 * AGLC4 rr 1.4.3–1.4.5: Ibid for back-to-back same-source citations;
 * author/case-name (n X) for later subsequent references.
 */
export function formatShortForm(input: ShortFormInput): string {
  const pin = input.pinpoint ? ` ${formatPinpointRef(input.pinpoint)}` : "";
  switch (input.mode) {
    case "ibid":
      return `Ibid${pin}`;
    case "subsequent": {
      const ref = input.footnoteRef !== undefined ? ` (n ${input.footnoteRef})` : "";
      return `${input.title}${ref}${pin}`;
    }
    case "short":
    default:
      return `${input.title}${pin}`;
  }
}

// Broad pinpoint patterns for parseCitation — most specific first
const PINPOINT_PATTERNS: ReadonlyArray<{ re: RegExp; extract: (m: RegExpMatchArray) => string }> = [
  { re: /\bat\s+\[(\d+)\]\s+to\s+\[(\d+)\]/, extract: (m) => `[${m[1]!}] to [${m[2]!}]` },
  { re: /\bat\s+(\d+)\s+to\s+(\d+)(?!\])/, extract: (m) => `${m[1]!} to ${m[2]!}` },
  { re: /\bat\s+\[(\d+)\]/, extract: (m) => `[${m[1]!}]` },
  { re: /\bat\s+(\d+)(?!\])/, extract: (m) => m[1]! },
  { re: /\bat\s+((?:ss?|reg|regs?|sch)\s+\S[^,;]*)/, extract: (m) => m[1]!.trim() },
];

export function parseCitation(text: string): ParsedCitation | null {
  const neutralMatch = text.match(NEUTRAL_CITATION_PATTERN);
  const reportedCitations: string[] = [];

  for (const pattern of REPORTED_CITATION_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[3] && Object.prototype.hasOwnProperty.call(REPORTERS, match[3])) {
      reportedCitations.push(match[0]);
    } else if (match && match[3] && /^[A-Z]{2,8}$/.test(match[3])) {
      // Accept uppercase-only reporters even if not in REPORTERS table
      reportedCitations.push(match[0]);
    }
  }

  if (!neutralMatch && reportedCitations.length === 0) {
    return null;
  }

  // Try each pinpoint pattern in priority order
  let pinpoint: string | undefined;
  for (const { re, extract } of PINPOINT_PATTERNS) {
    const m = text.match(re);
    if (m) {
      pinpoint = extract(m);
      break;
    }
  }

  return {
    neutralCitation: neutralMatch?.[0],
    reportedCitations,
    pinpoint,
  };
}

export function formatAGLC4(info: AGLC4FormatInput): string {
  let result = info.title;

  if (info.neutralCitation) {
    result += ` ${info.neutralCitation}`;
  }

  if (info.reportedCitation) {
    if (info.neutralCitation) {
      result += `,`;
    }
    result += ` ${info.reportedCitation}`;
  }

  if (info.pinpoint) {
    result += ` at ${info.pinpoint}`;
  }

  return result;
}

export function shortFormAGLC4(title: string, pinpoint?: string): string {
  return pinpoint ? `${title} ${pinpoint}` : title;
}

export function isValidNeutralCitation(s: string): boolean {
  return NEUTRAL_CITATION_PATTERN.test(s);
}

export function isValidReportedCitation(s: string): boolean {
  for (const pattern of REPORTED_CITATION_PATTERNS) {
    const match = s.match(pattern);
    if (match && match[3]) {
      // Accept if known reporter OR all-uppercase (standard abbreviation)
      if (
        Object.prototype.hasOwnProperty.call(REPORTERS, match[3]) ||
        /^[A-Z]{2,8}$/.test(match[3])
      ) {
        return true;
      }
    }
  }
  return false;
}

export function normaliseCitation(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export interface PinpointResult {
  paragraphNumber: number;
  pinpointString: string; // e.g. "at [2]"
  pageNumber?: number;
  pageString?: string; // e.g. "at 456"
}

export interface PinpointQuery {
  paragraphNumber?: number;
  phrase?: string;
}

/**
 * Finds the pinpoint reference for a paragraph in a judgment.
 * Can search by paragraph number or by a phrase appearing in the text.
 */
export function generatePinpoint(
  paragraphs: ParagraphBlock[],
  query: PinpointQuery,
): PinpointResult | null {
  let para: ParagraphBlock | undefined;

  if (query.paragraphNumber !== undefined) {
    para = paragraphs.find((p) => p.number === query.paragraphNumber);
  } else if (query.phrase) {
    const phraseLower = query.phrase.toLowerCase();
    para = paragraphs.find((p) => p.text.toLowerCase().includes(phraseLower));
  }

  if (!para) return null;

  return {
    paragraphNumber: para.number,
    pinpointString: `at [${para.number}]`,
    pageNumber: para.pageNumber,
    pageString: para.pageNumber !== undefined ? `at ${para.pageNumber}` : undefined,
  };
}

export async function validateCitation(citation: string): Promise<CitationValidationResult> {
  const normalised = normaliseCitation(citation);
  const match = normalised.match(NEUTRAL_CITATION_PATTERN);
  if (!match) {
    return {
      valid: false,
      message: "Not a recognised neutral citation format",
    };
  }
  const [, year, court, num] = match;
  const path = COURT_TO_AUSTLII_PATH[court!];
  if (!path) {
    return { valid: false, message: `Unknown court code: ${court}` };
  }
  const url = `https://www.austlii.edu.au/cgi-bin/viewdoc/${path}/${year}/${num}.html`;
  try {
    await axios.head(url, { timeout: 10000 });
    return { valid: true, canonicalCitation: normalised, austliiUrl: url };
  } catch {
    return {
      valid: false,
      message: "Citation not found on AustLII",
      austliiUrl: url,
    };
  }
}
