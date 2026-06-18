/**
 * jurisd - Citation service
 * Copyright (c) 2024 Russell Brenner
 * Licensed under the MIT License
 *
 * AGLC4-compliant citation parsing, formatting, validation, and normalisation.
 */
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
export type Pinpoint = {
    type: "para";
    n: number;
} | {
    type: "page";
    n: number;
} | {
    type: "paraRange";
    from: number;
    to: number;
} | {
    type: "pageRange";
    from: number;
    to: number;
} | {
    type: "legis";
    ref: string;
};
/** Convert a structured Pinpoint to the AGLC4 string fragment (without leading "at"). */
export declare function formatPinpointRef(p: Pinpoint): string;
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
export declare function formatShortForm(input: ShortFormInput): string;
export declare function parseCitation(text: string): ParsedCitation | null;
export declare function formatAGLC4(info: AGLC4FormatInput): string;
export declare function shortFormAGLC4(title: string, pinpoint?: string): string;
export declare function isValidNeutralCitation(s: string): boolean;
export declare function isValidReportedCitation(s: string): boolean;
export declare function normaliseCitation(s: string): string;
export interface PinpointResult {
    paragraphNumber: number;
    pinpointString: string;
    pageNumber?: number;
    pageString?: string;
}
export interface PinpointQuery {
    paragraphNumber?: number;
    phrase?: string;
}
/**
 * Finds the pinpoint reference for a paragraph in a judgment.
 * Can search by paragraph number or by a phrase appearing in the text.
 */
export declare function generatePinpoint(paragraphs: ParagraphBlock[], query: PinpointQuery): PinpointResult | null;
export declare function validateCitation(citation: string): Promise<CitationValidationResult>;
//# sourceMappingURL=citation.d.ts.map