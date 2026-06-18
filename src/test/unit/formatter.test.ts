import { describe, it, expect } from "vitest";
import {
  formatSearchResults,
  formatFetchResponse,
  type SearchSourceStatuses,
} from "../../utils/formatter.js";
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
  metadata: { contentLength: "123" },
};

const sampleWarning = {
  code: "austlii_cloudflare_blocked",
  source: "austlii",
  message: "AustLII search is blocked by a Cloudflare challenge.",
};
const sampleSources: SearchSourceStatuses = { austlii: "blocked", jade: "ok" };

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

  it("keeps no-warning JSON output as an array in text and structured data", () => {
    const result = formatSearchResults(sampleResults, "json");
    const parsed = JSON.parse(getText(result.content));
    expect(Array.isArray(parsed)).toBe(true);
    expect((result.structuredContent as { data: unknown }).data).toEqual(parsed);
  });

  it("formats warning JSON as a degraded result object in text and structured data", () => {
    const result = formatSearchResults(sampleResults, "json", {
      warnings: [sampleWarning],
      sources: sampleSources,
    });
    const parsed = JSON.parse(getText(result.content)) as {
      results: Array<SearchResult & { aglc4: string }>;
      warnings: (typeof sampleWarning)[];
      sources: SearchSourceStatuses;
      degraded: boolean;
    };
    expect(parsed.degraded).toBe(true);
    expect(parsed.results).toHaveLength(sampleResults.length);
    expect(parsed.warnings).toEqual([sampleWarning]);
    expect(parsed.sources).toEqual(sampleSources);
    expect((result.structuredContent as { data: unknown }).data).toEqual(parsed);
  });

  it("formats source-only degradation as a degraded result object", () => {
    const result = formatSearchResults([], "json", {
      sources: { austlii: "blocked", jade: "not_configured" },
    });
    const parsed = JSON.parse(getText(result.content)) as {
      results: SearchResult[];
      warnings: unknown[];
      sources: SearchSourceStatuses;
      degraded: boolean;
    };
    expect(parsed).toEqual({
      results: [],
      warnings: [],
      sources: { austlii: "blocked", jade: "not_configured" },
      degraded: true,
    });
    expect((result.structuredContent as { data: unknown }).data).toEqual(parsed);
  });

  it("should format results as text", () => {
    const result = formatSearchResults(sampleResults, "text");
    const text = getText(result.content);
    expect(text).toContain("1. Donoghue");
    expect(text).toContain("2. Mabo");
    expect(text).toContain("https://");
  });

  it("renders warnings in text output", () => {
    const result = formatSearchResults(sampleResults, "text", { warnings: [sampleWarning] });
    const text = getText(result.content);
    expect(text).toContain("Warning: AustLII search is blocked");
    expect(text).toContain("1. Donoghue");
  });

  it("renders source-only degradation in text output", () => {
    const result = formatSearchResults([], "text", {
      sources: { austlii: "blocked", jade: "not_configured" },
    });
    const text = getText(result.content);
    expect(text).toContain("Source status: austlii=blocked, jade=not_configured");
    expect((result.structuredContent as { data: { degraded: boolean } }).data.degraded).toBe(true);
  });

  it("should format results as markdown", () => {
    const result = formatSearchResults(sampleResults, "markdown");
    const text = getText(result.content);
    expect(text).toContain("- [Donoghue");
    expect(text).toContain("](https://");
  });

  it("renders warnings in markdown output", () => {
    const result = formatSearchResults(sampleResults, "markdown", { warnings: [sampleWarning] });
    const text = getText(result.content);
    expect(text).toContain("> AustLII search is blocked");
    expect(text).toContain("- [Donoghue");
  });

  it("renders source-only degradation in markdown output", () => {
    const result = formatSearchResults([], "markdown", {
      sources: { austlii: "blocked", jade: "not_configured" },
    });
    const text = getText(result.content);
    expect(text).toContain("> Source status: austlii=blocked, jade=not_configured");
    expect((result.structuredContent as { data: { degraded: boolean } }).data.degraded).toBe(true);
  });

  it("should format results as HTML", () => {
    const result = formatSearchResults(sampleResults, "html");
    const text = getText(result.content);
    expect(text).toContain("<ul>");
    expect(text).toContain("<li>");
    expect(text).toContain("</ul>");
    expect(text).toContain("<a href=");
  });

  it("renders escaped warnings in HTML output", () => {
    const result = formatSearchResults(sampleResults, "html", {
      warnings: [{ ...sampleWarning, message: "Blocked <script>alert(1)</script>" }],
    });
    const text = getText(result.content);
    expect(text).toContain('class="warning"');
    expect(text).toContain("&lt;script&gt;");
    expect(text).not.toContain("<script>");
  });

  it("renders source-only degradation in HTML output", () => {
    const result = formatSearchResults([], "html", {
      sources: { austlii: "blocked", jade: "not_configured" },
    });
    const text = getText(result.content);
    expect(text).toContain('class="source-status"');
    expect(text).toContain("austlii=blocked, jade=not_configured");
    expect((result.structuredContent as { data: { degraded: boolean } }).data.degraded).toBe(true);
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

  it("html format omits aglc4 span when formatted AGLC4 string is empty (line 62 false branch)", () => {
    // When title is empty string, formatAGLC4 returns "" which is falsy
    const results: SearchResult[] = [
      {
        title: "",
        url: "https://www.austlii.edu.au/test",
        source: "austlii",
        type: "case",
      },
    ];
    const result = formatSearchResults(results, "html");
    const text = getText(result.content);
    expect(text).not.toContain('class="aglc4"');
  });
});

it("ensureContent returns empty-text content item when given empty string", () => {
  // formatFetchResponse with empty text triggers the false branch of ensureContent
  const response = {
    text: "",
    contentType: "text/plain",
    sourceUrl: "https://example.com",
  };
  const result = formatFetchResponse(response as Parameters<typeof formatFetchResponse>[0], "text");
  expect(result.content).toHaveLength(1);
  expect(result.content[0]).toMatchObject({ type: "text", text: "" });
});

it("html format includes summary span when result has summary", () => {
  const results: SearchResult[] = [
    {
      title: "Test Case",
      url: "https://www.austlii.edu.au/test",
      source: "austlii",
      type: "case",
      neutralCitation: "[2024] HCA 1",
      summary: "High Court of Australia - 1 Jan 2024",
    },
  ];
  const result = formatSearchResults(results, "html");
  const text = getText(result.content);
  expect(text).toContain("High Court of Australia");
});

it("text format includes summary when result has summary", () => {
  const results: SearchResult[] = [
    {
      title: "Test Case",
      url: "https://www.austlii.edu.au/test",
      source: "austlii",
      type: "case",
      neutralCitation: "[2024] HCA 1",
      summary: "Federal Court of Australia",
    },
  ];
  const result = formatSearchResults(results, "text");
  const text = getText(result.content);
  expect(text).toContain("Federal Court of Australia");
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
  });

  it("should use preserved HTML structure when available", () => {
    const fetchWithHtml: FetchResponse = {
      ...sampleFetch,
      html: "<article><h1>Smith v Jones</h1><p>[1] Appeal allowed.</p></article>",
    };
    const result = formatFetchResponse(fetchWithHtml, "html");
    const text = getText(result.content);
    expect(text).toContain("<h1>Smith v Jones</h1>");
    expect(text).toContain("<p>[1] Appeal allowed.</p>");
    expect(text).not.toContain("<pre>");
  });

  it("html format includes print-friendly stylesheet when html field present", () => {
    const fetchWithHtml: FetchResponse = {
      ...sampleFetch,
      html: "<article><p>Judgment text</p></article>",
    };
    const result = formatFetchResponse(fetchWithHtml, "html");
    const text = getText(result.content);
    expect(text).toContain("<!DOCTYPE html>");
    expect(text).toContain("<style>");
    expect(text).toContain("font-family");
  });

  it("html format falls back to pre-wrapped text when no html field", () => {
    const result = formatFetchResponse(sampleFetch, "html");
    const text = getText(result.content);
    expect(text).toContain("<pre>");
  });
});
