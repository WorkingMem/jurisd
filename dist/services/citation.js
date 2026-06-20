/**
 * jurisd - Citation service
 * Copyright (c) 2024 Russell Brenner
 * Licensed under the MIT License
 *
 * AGLC4-compliant citation parsing, formatting, validation, and normalisation.
 */
import axios from "axios";
import { NEUTRAL_CITATION_PATTERN, REPORTED_CITATION_PATTERNS, COURT_TO_AUSTLII_PATH, REPORTERS, } from "../constants.js";
/** Convert a structured Pinpoint to the AGLC4 string fragment (without leading "at"). */
export function formatPinpointRef(p) {
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
/**
 * Format an AGLC4-compliant short-form, Ibid, or subsequent reference.
 *
 * AGLC4 rr 1.4.3–1.4.5: Ibid for back-to-back same-source citations;
 * author/case-name (n X) for later subsequent references.
 */
export function formatShortForm(input) {
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
const PINPOINT_PATTERNS = [
    { re: /\bat\s+\[(\d+)\]\s+to\s+\[(\d+)\]/, extract: (m) => `[${m[1]}] to [${m[2]}]` },
    { re: /\bat\s+(\d+)\s+to\s+(\d+)(?!\])/, extract: (m) => `${m[1]} to ${m[2]}` },
    { re: /\bat\s+\[(\d+)\]/, extract: (m) => `[${m[1]}]` },
    { re: /\bat\s+(\d+)(?!\])/, extract: (m) => m[1] },
    { re: /\bat\s+((?:ss?|reg|regs?|sch)\s+\S[^,;]*)/, extract: (m) => m[1].trim() },
];
export function parseCitation(text) {
    const neutralMatch = text.match(NEUTRAL_CITATION_PATTERN);
    const reportedCitations = [];
    for (const pattern of REPORTED_CITATION_PATTERNS) {
        const match = text.match(pattern);
        if (match && match[3] && Object.prototype.hasOwnProperty.call(REPORTERS, match[3])) {
            reportedCitations.push(match[0]);
        }
        else if (match && match[3] && /^[A-Z]{2,8}$/.test(match[3])) {
            // Accept uppercase-only reporters even if not in REPORTERS table
            reportedCitations.push(match[0]);
        }
    }
    if (!neutralMatch && reportedCitations.length === 0) {
        return null;
    }
    // Try each pinpoint pattern in priority order
    let pinpoint;
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
export function formatAGLC4(info) {
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
export function shortFormAGLC4(title, pinpoint) {
    return pinpoint ? `${title} ${pinpoint}` : title;
}
export function isValidNeutralCitation(s) {
    return NEUTRAL_CITATION_PATTERN.test(s);
}
export function isValidReportedCitation(s) {
    for (const pattern of REPORTED_CITATION_PATTERNS) {
        const match = s.match(pattern);
        if (match && match[3]) {
            // Accept if known reporter OR all-uppercase (standard abbreviation)
            if (Object.prototype.hasOwnProperty.call(REPORTERS, match[3]) ||
                /^[A-Z]{2,8}$/.test(match[3])) {
                return true;
            }
        }
    }
    return false;
}
export function normaliseCitation(s) {
    return s.replace(/\s+/g, " ").trim();
}
/**
 * Finds the pinpoint reference for a paragraph in a judgment.
 * Can search by paragraph number or by a phrase appearing in the text.
 */
export function generatePinpoint(paragraphs, query) {
    let para;
    if (query.paragraphNumber !== undefined) {
        para = paragraphs.find((p) => p.number === query.paragraphNumber);
    }
    else if (query.phrase) {
        const phraseLower = query.phrase.toLowerCase();
        para = paragraphs.find((p) => p.text.toLowerCase().includes(phraseLower));
    }
    if (!para)
        return null;
    return {
        paragraphNumber: para.number,
        pinpointString: `at [${para.number}]`,
        pageNumber: para.pageNumber,
        pageString: para.pageNumber !== undefined ? `at ${para.pageNumber}` : undefined,
    };
}
export async function validateCitation(citation) {
    const normalised = normaliseCitation(citation);
    const match = normalised.match(NEUTRAL_CITATION_PATTERN);
    if (!match) {
        return {
            valid: false,
            message: "Not a recognised neutral citation format",
        };
    }
    const [, year, court, num] = match;
    const path = COURT_TO_AUSTLII_PATH[court];
    if (!path) {
        return { valid: false, message: `Unknown court code: ${court}` };
    }
    const url = `https://www.austlii.edu.au/cgi-bin/viewdoc/${path}/${year}/${num}.html`;
    try {
        await axios.head(url, { timeout: 10000 });
        return { valid: true, canonicalCitation: normalised, austliiUrl: url };
    }
    catch {
        return {
            valid: false,
            message: "Citation not found on AustLII",
            austliiUrl: url,
        };
    }
}
//# sourceMappingURL=citation.js.map