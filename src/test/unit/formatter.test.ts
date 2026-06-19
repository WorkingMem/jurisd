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
  expect(getText(output.content)).toContain("\\(1992\\) 175 CLR 1");
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

it("markdown search output escapes untrusted result text", () => {
  const results: SearchResult[] = [
    {
      title: "Injected [link](https://evil.example)\u202e",
      url: "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
      source: "austlii",
      type: "case",
      summary: "Summary ](https://evil.example)\n2. fake \u001b]8;;https://evil.example\u0007",
    },
  ];
  const output = formatSearchResults(results, "markdown");
  const text = getText(output.content);
  expect(text).toContain("\\[link\\]\\(https://evil\\.example\\)");
  expect(text).toContain("Summary \\]\\(https://evil\\.example\\)");
  expect(text).not.toContain("[link](https://evil.example)");
  expect(text).not.toContain("\u001b");
  expect(text).not.toContain("\u202e");
  expect(text).not.toContain("\n2. fake");
});

it("text search output strips terminal controls and flattens injected newlines", () => {
  const results: SearchResult[] = [
    {
      title: "Injected\n2. fake\u202e",
      url: "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html",
      source: "austlii",
      type: "case",
      summary: "Summary\n3. fake \u001b[31mred",
    },
  ];
  const output = formatSearchResults(results, "text");
  const text = getText(output.content);
  expect(text).not.toContain("\u001b");
  expect(text).not.toContain("\u202e");
  expect(text).not.toContain("\n2. fake");
  expect(text).not.toContain("\n3. fake");
  expect(text).toContain("Summary 3. fake red");
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
    expect(text).toContain("```text");
  });

  it("should format fetch response as HTML", () => {
    const result = formatFetchResponse(sampleFetch, "html");
    const text = getText(result.content);
    expect(text).toContain("<article");
    expect(text).toContain("data-source=");
  });

  it("does not render preserved source HTML without a sanitizer", () => {
    const fetchWithHtml: FetchResponse = {
      ...sampleFetch,
      text: "Smith v Jones\n[1] Appeal allowed.",
      html: '<article><h1 onclick="alert(1)">Smith v Jones</h1><script>alert(1)</script></article>',
    };
    const result = formatFetchResponse(fetchWithHtml, "html");
    const text = getText(result.content);
    expect(text).toContain("<pre>");
    expect(text).toContain("Smith v Jones");
    expect(text).not.toContain("<h1");
    expect(text).not.toContain("onclick");
    expect(text).not.toContain("<script");
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

  it("text fetch output strips terminal controls while preserving document line breaks", () => {
    const result = formatFetchResponse(
      {
        ...sampleFetch,
        text: "Line 1\r\nLine 2 \u001b[31mred\u001b[0m \u202e",
      },
      "text",
    );
    const text = getText(result.content);
    expect(text).toBe("Line 1\nLine 2 red ");
    expect(text).not.toContain("\u001b");
    expect(text).not.toContain("\u202e");
  });

  it("markdown fetch output fences source text and strips unsafe controls", () => {
    const result = formatFetchResponse(
      {
        ...sampleFetch,
        sourceUrl: "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23).html",
        text: "Judgment\n- injected item\n```nested```\n\u001b]8;;https://evil.example\u0007link",
      },
      "markdown",
    );
    const text = getText(result.content);
    expect(text).toContain("23%29.html");
    expect(text).toContain("````text");
    expect(text).toContain("- injected item");
    expect(text).not.toContain("\u001b");
    expect(text).not.toContain("]8;;https://evil.example");
  });
});
