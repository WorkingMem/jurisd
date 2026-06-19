import { describe, it, expect } from "vitest";
import { assertFetchableUrl, assertRedirectAllowed, MAX_REDIRECTS } from "../../utils/url-guard.js";

describe("assertFetchableUrl", () => {
  it("permits AustLII HTTPS URL", () => {
    expect(() => assertFetchableUrl("https://www.austlii.edu.au/case")).not.toThrow();
  });
  it("permits removed.invalid HTTPS URL", () => {
    expect(() => assertFetchableUrl("https://removed.invalid/article/12345")).not.toThrow();
  });
  it("permits classic.austlii.edu.au", () => {
    expect(() => assertFetchableUrl("https://classic.austlii.edu.au/au/cases")).not.toThrow();
  });
  it("blocks file:// URL", () => {
    expect(() => assertFetchableUrl("file:///etc/passwd")).toThrow(/Only HTTPS/);
  });
  it("blocks localhost", () => {
    expect(() => assertFetchableUrl("https://localhost:8080/path")).toThrow(/not in permitted/);
  });
  it("blocks HTTP (non-HTTPS)", () => {
    expect(() => assertFetchableUrl("http://www.austlii.edu.au/case")).toThrow(/Only HTTPS/);
  });
  it("blocks arbitrary external host", () => {
    expect(() => assertFetchableUrl("https://evil.com/path")).toThrow(/not in permitted/);
  });
  it("blocks 127.0.0.1", () => {
    expect(() => assertFetchableUrl("https://127.0.0.1/path")).toThrow(/not in permitted/);
  });
  it("throws on invalid URL", () => {
    expect(() => assertFetchableUrl("not-a-url")).toThrow(/Invalid URL/);
  });
});

describe("assertRedirectAllowed", () => {
  it("permits a redirect to an allowlisted host (via href)", () => {
    expect(() =>
      assertRedirectAllowed({ href: "https://classic.austlii.edu.au/au/cases/x.html" }),
    ).not.toThrow();
  });
  it("permits a redirect reconstructed from protocol/host/path", () => {
    expect(() =>
      assertRedirectAllowed({ protocol: "https:", host: "removed.invalid", path: "/article/1" }),
    ).not.toThrow();
  });
  it("blocks a redirect to a cloud-metadata address", () => {
    expect(() =>
      assertRedirectAllowed({ href: "https://169.254.169.254/latest/meta-data/" }),
    ).toThrow(/not in permitted/);
  });
  it("blocks a redirect to localhost", () => {
    expect(() =>
      assertRedirectAllowed({ protocol: "https:", host: "localhost", path: "/" }),
    ).toThrow(/not in permitted/);
  });
  it("blocks a redirect downgraded to http", () => {
    expect(() => assertRedirectAllowed({ href: "http://www.austlii.edu.au/x" })).toThrow(
      /Only HTTPS/,
    );
  });
  it("strips sensitive headers before following an allowed redirect", () => {
    const headers: Record<string, string> = {
      "User-Agent": "jurisd-test",
      Cookie: "cf_clearance=secret",
      Authorization: "Bearer secret",
    };
    expect(() =>
      assertRedirectAllowed({
        href: "https://removed.invalid/article/1",
        headers,
      }),
    ).not.toThrow();
    expect(headers).toEqual({ "User-Agent": "jurisd-test" });
  });
  it("bounds the redirect chain to a small number", () => {
    expect(MAX_REDIRECTS).toBeLessThanOrEqual(5);
    expect(MAX_REDIRECTS).toBeGreaterThan(0);
  });
});
