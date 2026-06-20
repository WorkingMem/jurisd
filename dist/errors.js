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
        return (`AustLII is behind a Cloudflare challenge and cannot be accessed directly ` +
            `(${resourceUrl})${fallbackClause}. Direct AustLII search and fetch are ` +
            "unavailable without a configured fallback source. Configure ONE of: " +
            "EXA_API_KEY (Exa neural search — returns canonical austlii.edu.au URLs), or " +
            "JADE_SESSION_COOKIE (jade.io full text). " +
            "Advanced: AUSTLII_CF_CLEARANCE from a solved browser session.");
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