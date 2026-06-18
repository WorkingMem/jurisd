export interface ParagraphBlock {
    number: number;
    text: string;
    pageNumber?: number;
}
export interface FetchResponse {
    text: string;
    /** Cleaned HTML preserving document structure (only set for HTML sources). */
    html?: string;
    contentType: string;
    sourceUrl: string;
    metadata?: Record<string, string>;
    paragraphs?: ParagraphBlock[];
    etag?: string;
    lastModified?: string;
}
/**
 * Fetches a legal document from a URL and extracts its text content.
 *
 * Supports HTML pages, PDF documents, and plain text.
 *
 * AustLII URLs are routed through the impit transport with Cloudflare-challenge
 * detection and an OALC corpus fallback; jade.io and all other URLs are
 * unchanged.
 *
 * @param url - Absolute URL of the document to fetch
 * @returns Promise resolving to a {@link FetchResponse} with extracted text
 * @throws {Error} If the network request fails or the content type is unsupported
 */
export declare function fetchDocumentText(url: string): Promise<FetchResponse>;
//# sourceMappingURL=fetcher.d.ts.map