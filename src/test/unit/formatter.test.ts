import { describe, it, expect } from "vitest";
import { formatSearchResults, formatFetchResponse } from "../../utils/formatter.js";
import type { SearchResult } from "../../services/austlii.js";
import type { FetchResponse } from "../../services/fetcher.js";

/** Helper to extract text from the first content item */
function getText(content: { type: string; text?: string }[]): string {
  const first = content[0] as { type: "text"; text: string };
  return first.text;
}

const sampleResults: SearchResult[] = [
  {
    title: "Donoghue v Stevenson [1932] UKHL 100",
    neutralCitation: "[1932] UKHL 100",
    url: "https://www.austlii.edu.au/au/cases/cth/HCA/1932/100.html",
    source: "austlii",
    type: "case",
    year: "1932",
  },
  {
    title: "Mabo v Queensland (No 2) [1992] HCA 23",
    neutralCitation: "[1992] HCA 23",
    reportedCitation: "(1992) 175 CLR 1",
    url: "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
    source: "austlii",
    type: "case",
    year: "1992",
    jurisdiction: "cth",
  },
];

const sampleFetch: FetchResponse = {
  text: "This is a sample judgement text.",
  contentType: "text/html",
  sourceUrl: "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
  ocrUsed: false,
  metadata: { contentLength: "123" },
};

describe("formatSearchResults", () => {
  it("should format results as JSON", () => {
    const result = formatSearchResults(sampleResults, "json");
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    const text = getText(result.content);
    expect(text).toContain("Donoghue");
    // JSON should be parseable
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it("should format results as text", () => {
    const result = formatSearchResults(sampleResults, "text");
    const text = getText(result.content);
    expect(text).toContain("1. Donoghue");
    expect(text).toContain("2. Mabo");
    expect(text).toContain("https://");
  });

  it("should format results as markdown", () => {
    const result = formatSearchResults(sampleResults, "markdown");
    const text = getText(result.content);
    expect(text).toContain("- [Donoghue");
    expect(text).toContain("](https://");
  });

  it("should format results as HTML", () => {
    const result = formatSearchResults(sampleResults, "html");
    const text = getText(result.content);
    expect(text).toContain("<ul>");
    expect(text).toContain("<li>");
    expect(text).toContain("</ul>");
    expect(text).toContain("<a href=");
  });

  it("should handle empty results", () => {
    const result = formatSearchResults([], "json");
    expect(result.content.length).toBeGreaterThan(0);
    const parsed = JSON.parse(getText(result.content));
    expect(parsed).toEqual([]);
  });

  it("should escape HTML entities in html format", () => {
    const results: SearchResult[] = [
      {
        title: 'Test <script>alert("xss")</script>',
        url: "https://example.com",
        source: "austlii",
        type: "case",
      },
    ];
    const result = formatSearchResults(results, "html");
    const text = getText(result.content);
    expect(text).not.toContain("<script>");
    expect(text).toContain("&lt;script&gt;");
  });
});

it("text format includes reportedCitation when present", () => {
  const results: SearchResult[] = [
    {
      title: "Mabo v Queensland (No 2)",
      url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html",
      source: "austlii",
      type: "case",
      neutralCitation: "[1992] HCA 23",
      reportedCitation: "(1992) 175 CLR 1",
    },
  ];
  const output = formatSearchResults(results, "text");
  expect(getText(output.content)).toContain("(1992) 175 CLR 1");
});

it("markdown format includes reportedCitation when present", () => {
  const results: SearchResult[] = [
    {
      title: "Mabo v Queensland (No 2)",
      url: "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html",
      source: "austlii",
      type: "case",
      neutralCitation: "[1992] HCA 23",
      reportedCitation: "(1992) 175 CLR 1",
    },
  ];
  const output = formatSearchResults(results, "markdown");
  expect(getText(output.content)).toContain("(1992) 175 CLR 1");
});

it("markdown format uses hyphen not em dash for summary", () => {
  const results: SearchResult[] = [
    {
      title: "Test Case",
      url: "https://www.austlii.edu.au/test",
      source: "austlii",
      type: "case",
      summary: "High Court of Australia - 1 Jan 2024",
    },
  ];
  const output = formatSearchResults(results, "markdown");
  expect(getText(output.content)).not.toContain("\u2014"); // em dash
});

describe("formatFetchResponse", () => {
  it("should format fetch response as JSON", () => {
    const result = formatFetchResponse(sampleFetch, "json");
    const text = getText(result.content);
    expect(() => JSON.parse(text)).not.toThrow();
    const parsed = JSON.parse(text);
    expect(parsed.sourceUrl).toBe(sampleFetch.sourceUrl);
    expect(parsed.ocrUsed).toBe(false);
  });

  it("should format fetch response as text", () => {
    const result = formatFetchResponse(sampleFetch, "text");
    const text = getText(result.content);
    expect(text).toBe(sampleFetch.text);
  });

  it("should format fetch response as markdown", () => {
    const result = formatFetchResponse(sampleFetch, "markdown");
    const text = getText(result.content);
    expect(text).toContain("> Source:");
    expect(text).toContain(sampleFetch.sourceUrl);
    expect(text).toContain(sampleFetch.text);
  });

  it("should format fetch response as HTML", () => {
    const result = formatFetchResponse(sampleFetch, "html");
    const text = getText(result.content);
    expect(text).toContain("<article");
    expect(text).toContain("data-source=");
    expect(text).toContain("data-ocr=");
  });
});
