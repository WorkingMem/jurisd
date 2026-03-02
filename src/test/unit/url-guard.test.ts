import { describe, it, expect } from "vitest";
import { assertFetchableUrl } from "../../utils/url-guard.js";

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
