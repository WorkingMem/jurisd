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
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly cause?: Error,
  ) {
    super(message);
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
  constructor(
    public readonly resourceUrl: string,
    public readonly fallbackTried: boolean,
  ) {
    super(CloudflareBlockedError.buildMessage(resourceUrl, fallbackTried), 403);
    this.name = "CloudflareBlockedError";
  }

  /**
   * Builds the actionable, secret-free guidance message. Kept static so it can
   * run before `super()` completes.
   */
  private static buildMessage(resourceUrl: string, fallbackTried: boolean): string {
    const fallbackClause = fallbackTried
      ? ", and the document was not in the Open Australian Legal Corpus fallback"
      : "";
    return (
      `AustLII is behind a Cloudflare challenge and cannot be accessed directly ` +
      `(${resourceUrl})${fallbackClause}. Direct AustLII search and fetch are ` +
      "unavailable without a configured fallback source. Configure ONE of: " +
      "EXA_API_KEY (Exa neural search — returns canonical austlii.edu.au URLs), or " +
      "SESSION_COOKIE (removed.invalid full text). " +
      "Advanced: AUSTLII_CF_CLEARANCE from a solved browser session."
    );
  }
}

/**
 * Error thrown when a network request fails (fetch, axios, etc.).
 */
export class NetworkError extends Error {
  constructor(
    message: string,
    public readonly url: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "NetworkError";
  }
}

/**
 * Error thrown when an HTTP response is reachable but not successful after any
 * domain-specific challenge handling has run.
 */
export class HttpStatusError extends NetworkError {
  constructor(
    public readonly url: string,
    public readonly statusCode: number,
  ) {
    super(`HTTP ${statusCode} fetching ${url}`, url);
    this.name = "HttpStatusError";
  }
}

/**
 * Error thrown when parsing HTML or other response content fails.
 */
export class ParseError extends Error {
  constructor(
    message: string,
    public readonly content?: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "ParseError";
  }
}
