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
  pinpoint?: string;
}

export interface CitationValidationResult {
  valid: boolean;
  canonicalCitation?: string;
  austliiUrl?: string;
  message?: string;
}

const PINPOINT_PATTERN = /\bat\s+\[(\d+)\]/;

export function parseCitation(text: string): ParsedCitation | null {
  const neutralMatch = text.match(NEUTRAL_CITATION_PATTERN);
  const reportedCitations: string[] = [];

  for (const pattern of REPORTED_CITATION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      reportedCitations.push(match[0]);
    }
  }

  if (!neutralMatch && reportedCitations.length === 0) {
    return null;
  }

  const pinpointMatch = text.match(PINPOINT_PATTERN);

  return {
    neutralCitation: neutralMatch?.[0],
    reportedCitations,
    pinpoint: pinpointMatch ? `[${pinpointMatch[1]}]` : undefined,
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
  return REPORTED_CITATION_PATTERNS.some((pattern) => pattern.test(s));
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

export async function validateCitation(
  citation: string,
): Promise<CitationValidationResult> {
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
