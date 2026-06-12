/**
 * AusLaw MCP - Custom error classes
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
      `AustLII blocked automated access to ${resourceUrl} behind a Cloudflare challenge. ` +
      `The TLS-impersonating fetch did not clear it${fallbackClause}. ` +
      "Options: (1) set AUSTLII_CF_CLEARANCE from a browser session; " +
      "(2) open the URL in a browser; " +
      "(3) for covered jurisdictions, retrieve from the primary register " +
      "(hcourt.gov.au / fedcourt.gov.au / legislation.gov.au / caselaw.nsw.gov.au)."
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

/**
 * Error thrown when OCR processing fails.
 */
export class OcrError extends Error {
  constructor(
    message: string,
    public readonly filePath?: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "OcrError";
  }
}
