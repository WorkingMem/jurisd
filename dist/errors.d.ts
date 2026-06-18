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
export declare class AustLiiError extends Error {
    readonly statusCode?: number | undefined;
    readonly cause?: Error | undefined;
    constructor(message: string, statusCode?: number | undefined, cause?: Error | undefined);
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
export declare class CloudflareBlockedError extends AustLiiError {
    readonly resourceUrl: string;
    readonly fallbackTried: boolean;
    constructor(resourceUrl: string, fallbackTried: boolean);
    /**
     * Builds the actionable, secret-free guidance message. Kept static so it can
     * run before `super()` completes.
     */
    private static buildMessage;
}
/**
 * Error thrown when a network request fails (fetch, axios, etc.).
 */
export declare class NetworkError extends Error {
    readonly url: string;
    readonly cause?: Error | undefined;
    constructor(message: string, url: string, cause?: Error | undefined);
}
/**
 * Error thrown when parsing HTML or other response content fails.
 */
export declare class ParseError extends Error {
    readonly content?: string | undefined;
    readonly cause?: Error | undefined;
    constructor(message: string, content?: string | undefined, cause?: Error | undefined);
}
//# sourceMappingURL=errors.d.ts.map