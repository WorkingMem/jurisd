import { describe, it, expect } from "vitest";
import {
  AustLiiError,
  CloudflareBlockedError,
  HttpStatusError,
  NetworkError,
  ParseError,
} from "../../errors.js";

describe("Custom error classes", () => {
  describe("AustLiiError", () => {
    it("should have correct name", () => {
      const err = new AustLiiError("search failed");
      expect(err.name).toBe("AustLiiError");
      expect(err.message).toBe("search failed");
      expect(err).toBeInstanceOf(Error);
    });

    it("should store statusCode", () => {
      const err = new AustLiiError("not found", 404);
      expect(err.statusCode).toBe(404);
    });

    it("should store cause", () => {
      const cause = new Error("network timeout");
      const err = new AustLiiError("search failed", 500, cause);
      expect(err.cause).toBe(cause);
    });
  });

  describe("CloudflareBlockedError", () => {
    const url = "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html";

    it("extends AustLiiError and is an Error", () => {
      const err = new CloudflareBlockedError(url, true);
      expect(err).toBeInstanceOf(AustLiiError);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("CloudflareBlockedError");
    });

    it("has statusCode 403", () => {
      const err = new CloudflareBlockedError(url, true);
      expect(err.statusCode).toBe(403);
    });

    it("carries resourceUrl and fallbackTried", () => {
      const err = new CloudflareBlockedError(url, false);
      expect(err.resourceUrl).toBe(url);
      expect(err.fallbackTried).toBe(false);
    });

    it("has an actionable message naming the configurable fallbacks and the URL", () => {
      const err = new CloudflareBlockedError(url, true);
      expect(err.message).toContain("EXA_API_KEY");
      expect(err.message).toContain("SESSION_COOKIE");
      expect(err.message).toContain("AUSTLII_CF_CLEARANCE");
      expect(err.message).toContain(url);
    });

    it("message mentions the corpus fallback only when fallbackTried is true", () => {
      const tried = new CloudflareBlockedError(url, true);
      const notTried = new CloudflareBlockedError(url, false);
      expect(tried.message).toContain("Open Australian Legal Corpus");
      expect(notTried.message).not.toContain("Open Australian Legal Corpus");
    });

    it("never includes a cookie or cf_clearance value in the message", () => {
      const err = new CloudflareBlockedError(url, true);
      expect(err.message).not.toMatch(/cf_clearance=/);
      expect(err.message).not.toMatch(/Cookie:/);
    });
  });

  describe("NetworkError", () => {
    it("should store url", () => {
      const err = new NetworkError("timeout", "https://example.com");
      expect(err.name).toBe("NetworkError");
      expect(err.url).toBe("https://example.com");
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe("HttpStatusError", () => {
    it("stores url and statusCode", () => {
      const err = new HttpStatusError("https://example.com/missing", 404);
      expect(err.name).toBe("HttpStatusError");
      expect(err.url).toBe("https://example.com/missing");
      expect(err.statusCode).toBe(404);
      expect(err).toBeInstanceOf(NetworkError);
    });
  });

  describe("ParseError", () => {
    it("should store partial content", () => {
      const err = new ParseError("invalid html", "<html>broken");
      expect(err.name).toBe("ParseError");
      expect(err.content).toBe("<html>broken");
      expect(err).toBeInstanceOf(Error);
    });
  });
});
