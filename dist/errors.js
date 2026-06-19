/**
 * jurisd - Custom error classes
 * Copyright (c) 2024 Russell Brenner
 * Licensed under the MIT License
 *
 * Provides structured error types for different failure modes.
 */
/**
 * Error thrown when an AustLII search or API call fails.
 */
export class AustLiiError extends Error {
    statusCode;
    cause;
    constructor(message, statusCode, cause) {
        super(message);
        this.statusCode = statusCode;
        this.cause = cause;
        this.name = "AustLiiError";
    }
}
/**
 * Error thrown when AustLII serves a Cloudflare challenge instead of the
 * requested document and the request could not be satisfied by any fallback.
 *
 * Carries the blocked {@link resourceUrl} and a {@link fallbackTried} flag
 * indicating whether the OALC corpus fallback was consulted (true) or skipped
 * because it was disabled (false). The message is deliberately actionable and
 * never contains cookies, `cf_clearance`, or any other secret.
 */
export class CloudflareBlockedError extends AustLiiError {
    resourceUrl;
    fallbackTried;
    constructor(resourceUrl, fallbackTried) {
        super(CloudflareBlockedError.buildMessage(resourceUrl, fallbackTried), 403);
        this.resourceUrl = resourceUrl;
        this.fallbackTried = fallbackTried;
        this.name = "CloudflareBlockedError";
    }
    /**
     * Builds the actionable, secret-free guidance message. Kept static so it can
     * run before `super()` completes.
     */
    static buildMessage(resourceUrl, fallbackTried) {
        const fallbackClause = fallbackTried
            ? ", and the document was not in the Open Australian Legal Corpus fallback"
            : "";
        return (`AustLII blocked automated access to ${resourceUrl} behind a Cloudflare challenge. ` +
            `The TLS-impersonating fetch did not clear it${fallbackClause}. ` +
            "Options: (1) provide a valid AUSTLII_CF_CLEARANCE for the same client environment; " +
            "(2) verify the bundled impit transport is installed and enabled; " +
            "(3) for covered jurisdictions, retrieve from the primary register " +
            "(hcourt.gov.au / fedcourt.gov.au / legislation.gov.au / caselaw.nsw.gov.au).");
    }
}
/**
 * Error thrown when a network request fails (fetch, axios, etc.).
 */
export class NetworkError extends Error {
    url;
    cause;
    constructor(message, url, cause) {
        super(message);
        this.url = url;
        this.cause = cause;
        this.name = "NetworkError";
    }
}
/**
 * Error thrown when an HTTP response is reachable but not successful after any
 * domain-specific challenge handling has run.
 */
export class HttpStatusError extends NetworkError {
    url;
    statusCode;
    constructor(url, statusCode) {
        super(`HTTP ${statusCode} fetching ${url}`, url);
        this.url = url;
        this.statusCode = statusCode;
        this.name = "HttpStatusError";
    }
}
/**
 * Error thrown when parsing HTML or other response content fails.
 */
export class ParseError extends Error {
    content;
    cause;
    constructor(message, content, cause) {
        super(message);
        this.content = content;
        this.cause = cause;
        this.name = "ParseError";
    }
}
//# sourceMappingURL=errors.js.map