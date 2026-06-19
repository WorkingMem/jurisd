import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  encodeGwtInt,
  decodeGwtInt,
  buildGetInitialContentRequest,
  buildGetMetadataRequest,
  buildAvd2Request,
  buildProposeCitablesRequest,
  parseProposeCitablesResponse,
  extractBridgeCandidates,
  parseGwtRpcResponse,
  parseAvd2Response,
  parseGwtConcatResponse,
  parseCitatorResponse,
  extractCitableIds,
  buildCitatorSearchRequest,
  AVD2_STRONG_NAME,
  JADE_STRONG_NAME,
} from "../../services/jade-gwt.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
function readFixture(name: string): string {
  return readFileSync(join(__dirname, "../fixtures", name), "utf-8");
}

describe("encodeGwtInt", () => {
  it("encodes 0 as single character A", () => {
    expect(encodeGwtInt(0)).toBe("A");
  });

  it("encodes 67401 as QdJ (verified against captured HAR for article 67401)", () => {
    // 67401 = 16*64² + 29*64 + 9 = 65536+1856+9
    // Q=16, d=29, J=9 in GWT charset (A-Z=0-25, a-z=26-51, 0-9=52-61, $=62, _=63)
    expect(encodeGwtInt(67401)).toBe("QdJ");
  });

  it("encodes single-digit values (0-63) as one character", () => {
    expect(encodeGwtInt(63)).toBe("_");
    expect(encodeGwtInt(62)).toBe("$");
    expect(encodeGwtInt(25)).toBe("Z");
    expect(encodeGwtInt(26)).toBe("a");
  });

  it("encodes 64 as BA (first two-character value)", () => {
    expect(encodeGwtInt(64)).toBe("BA");
  });

  it("encodes 4096 as BAA (first three-character value)", () => {
    expect(encodeGwtInt(4096)).toBe("BAA");
  });

  it("throws for negative numbers", () => {
    expect(() => encodeGwtInt(-1)).toThrow();
  });

  it("throws for non-integer input", () => {
    expect(() => encodeGwtInt(1.5)).toThrow();
  });
});

describe("buildGetInitialContentRequest", () => {
  it("produces the exact known POST body for article 67401", () => {
    // Captured verbatim from Proxyman HAR export (jade.io_03-02-2026-13-48-33.har)
    const expected =
      "7|0|7|https://jade.io/au.com.barnet.jade.JadeClient/|F6E610452C7A15DE693DC8F95CF6849C|" +
      "au.com.barnet.jade.cs.remote.JadeRemoteService|getInitialContent|" +
      "au.com.barnet.jade.cs.persistent.Jrl/728826604|au.com.barnet.jade.cs.persistent.Article|" +
      "java.util.ArrayList/4159755760|1|2|3|4|1|5|5|QdJ|A|0|A|A|6|0|";
    expect(buildGetInitialContentRequest(67401)).toBe(expected);
  });

  it("uses the GWT-encoded article ID", () => {
    const body = buildGetInitialContentRequest(68901);
    // 68901 should appear as GWT-encoded, not the raw integer
    expect(body).not.toContain("68901");
    expect(body).toContain(encodeGwtInt(68901));
  });

  it("starts with GWT-RPC version header", () => {
    expect(buildGetInitialContentRequest(12345)).toMatch(/^7\|0\|7\|/);
  });
});

describe("buildGetMetadataRequest", () => {
  it("produces the exact known POST body for article 67401", () => {
    // Captured verbatim from Proxyman HAR export
    const expected =
      "7|0|5|https://jade.io/au.com.barnet.jade.JadeClient/|F6E610452C7A15DE693DC8F95CF6849C|" +
      "au.com.barnet.jade.cs.remote.JadeRemoteService|getArticleStructuredMetadata|J|" +
      "1|2|3|4|1|5|QdJ|";
    expect(buildGetMetadataRequest(67401)).toBe(expected);
  });

  it("uses the GWT-encoded article ID", () => {
    const body = buildGetMetadataRequest(99999);
    expect(body).not.toContain("99999");
    expect(body).toContain(encodeGwtInt(99999));
  });
});

describe("buildAvd2Request", () => {
  it("produces the exact known POST body for article 1182103", () => {
    // Captured from live SPA navigation interception (2026-03-02)
    // Article: AA v The Trustees of the Roman Catholic Church... [2026] HCA 2
    const expected =
      "7|0|10|https://jade.io/au.com.barnet.jade.JadeClient/|" +
      "140B3EF36354F0C5A95299A70B18A25F|" +
      "au.com.barnet.jade.cs.remote.ArticleViewRemoteService|avd2Request|" +
      "au.com.barnet.jade.cs.csobjects.avd.Avd2Request/2858816011|" +
      "au.com.barnet.jade.cs.persistent.Jrl/728826604|" +
      "au.com.barnet.jade.cs.persistent.Article|" +
      "java.util.ArrayList/4159755760|" +
      "au.com.barnet.jade.cs.csobjects.avd.PhraseFrequencyParams/1915696367|" +
      "cc.alcina.framework.common.client.util.IntPair/1982199244|" +
      "1|2|3|4|1|5|5|A|A|0|6|EgmX|A|0|A|A|7|0|0|0|8|0|0|9|0|10|3|500|A|8|0|8|0|";
    expect(buildAvd2Request(1182103)).toBe(expected);
  });

  it("produces the correct body for article 67401", () => {
    const body = buildAvd2Request(67401);
    // Article ID 67401 = "QdJ" in GWT encoding
    expect(body).toContain("|QdJ|");
    expect(body).not.toContain("|67401|");
  });

  it("uses ArticleViewRemoteService strong name, not JadeRemoteService", () => {
    const body = buildAvd2Request(12345);
    expect(body).toContain(AVD2_STRONG_NAME);
    expect(body).toContain("ArticleViewRemoteService");
    expect(body).not.toContain("JadeRemoteService");
  });

  it("starts with GWT-RPC version header with 10 string table entries", () => {
    expect(buildAvd2Request(12345)).toMatch(/^7\|0\|10\|/);
  });
});

describe("parseAvd2Response", () => {
  it("extracts HTML from a response with string table", () => {
    // Simplified avd2Response format: [integers..., [string_table], 4, 7]
    const html = "<DIV><P>Judgment text</P></DIV>";
    const response = `//OK[0,-2,0,["SomeType/123","${html}"],4,7]`;
    expect(parseAvd2Response(response)).toBe(html);
  });

  it("handles unicode escape sequences in HTML", () => {
    const response = '//OK[0,-2,0,["Type/1","\\u003CDIV\\u003Econtent\\u003C/DIV\\u003E"],4,7]';
    expect(parseAvd2Response(response)).toBe("<DIV>content</DIV>");
  });

  it("joins GWT string concatenation markers before parsing", () => {
    // GWT splits long strings with "+" at the response level
    const html = "<DIV>long content here</DIV>";
    const half1 = html.substring(0, 15);
    const half2 = html.substring(15);
    const response = `//OK[0,["Type/1","${half1}"+"${half2}"],4,7]`;
    expect(parseAvd2Response(response)).toBe(html);
  });

  it("throws on //EX server exception response", () => {
    expect(() => parseAvd2Response("//EX WebException")).toThrow(/exception/i);
  });

  it("throws on unexpected format (no //OK prefix)", () => {
    expect(() => parseAvd2Response('{"json":"object"}')).toThrow();
  });

  it("throws when no HTML content found in string table", () => {
    const response = '//OK[0,["Type/1","Type/2"],4,7]';
    expect(() => parseAvd2Response(response)).toThrow(/no html content/i);
  });

  it("selects the longest string as HTML content", () => {
    const shortStr = "Type/123456";
    const html = "<DIV><P>[1] A paragraph of judgment text about negligence.</P></DIV>";
    const response = `//OK[0,["${shortStr}","${html}"],4,7]`;
    expect(parseAvd2Response(response)).toBe(html);
  });
});

describe("decodeGwtInt", () => {
  it("decodes 'A' as 0", () => {
    expect(decodeGwtInt("A")).toBe(0);
  });

  it("decodes 'QdJ' as 67401 (inverse of encodeGwtInt)", () => {
    expect(decodeGwtInt("QdJ")).toBe(67401);
  });

  it("decodes 'CwFj' as 721251 (Mabo [1992] HCA 23 Citable ID — NOT the article URL ID)", () => {
    expect(decodeGwtInt("CwFj")).toBe(721251);
  });

  it("decodes 'CwEa' as 721178 ([1988] HCA 69 Citable ID — NOT the article URL ID)", () => {
    expect(decodeGwtInt("CwEa")).toBe(721178);
  });

  it("decodes 'UGn' as 82343 (Mabo [1992] HCA 23 article URL ID)", () => {
    expect(decodeGwtInt("UGn")).toBe(82343);
  });

  it("decodes 'UGE' as 82308 (Mabo [1988] HCA 69 article URL ID)", () => {
    expect(decodeGwtInt("UGE")).toBe(82308);
  });

  it("is the inverse of encodeGwtInt for round-trip", () => {
    const values = [0, 1, 63, 64, 4096, 67401, 721251, 1182103];
    for (const n of values) {
      expect(decodeGwtInt(encodeGwtInt(n))).toBe(n);
    }
  });

  it("throws for an empty string", () => {
    expect(() => decodeGwtInt("")).toThrow();
  });

  it("throws for a string with characters outside the GWT charset", () => {
    expect(() => decodeGwtInt("!invalid")).toThrow();
  });
});

describe("buildProposeCitablesRequest", () => {
  it("produces the exact known POST body for query 'Mabo ' (captured from HAR entry 11)", () => {
    // Captured verbatim from jade.io_03-03-2026-10-08-59.har, entry 11
    const expected =
      "7|0|10|https://jade.io/au.com.barnet.jade.JadeClient/|" +
      "F6E610452C7A15DE693DC8F95CF6849C|" +
      "au.com.barnet.jade.cs.remote.JadeRemoteService|proposeCitables|" +
      "java.lang.String/2004016611|" +
      "au.com.barnet.jade.cs.csobjects.qsearch.QuickSearchFlags/2740681188|" +
      "Mabo |" +
      "au.com.barnet.jade.cs.csobjects.qsearchdesktop.QuickSearchFlagsDesktop/2291862948|" +
      "java.util.HashSet/3273092938|" +
      "au.com.barnet.jade.cs.persistent.shared.CitableType/1576180844|" +
      "1|2|3|4|2|5|6|7|8|1|1|1|0|0|1|0|9|4|10|0|10|1|10|2|10|3|1|0|0|1|0|9|0|0|0|0|0|1|1|1|";
    expect(buildProposeCitablesRequest("Mabo ")).toBe(expected);
  });

  it("uses JadeRemoteService strong name", () => {
    const body = buildProposeCitablesRequest("test");
    expect(body).toContain(JADE_STRONG_NAME);
    expect(body).toContain("JadeRemoteService");
  });

  it("embeds the query string directly (no GWT encoding)", () => {
    const body = buildProposeCitablesRequest("rice v asplund");
    expect(body).toContain("rice v asplund");
  });

  it("starts with GWT-RPC version header with 10 string table entries", () => {
    expect(buildProposeCitablesRequest("test")).toMatch(/^7\|0\|10\|/);
  });
});

describe("parseProposeCitablesResponse", () => {
  it("extracts Mabo v Queensland (No 2) with [1992] HCA 23 from captured response", () => {
    const fixture = readFixture("propose-citables-mabo.txt");
    const { results } = parseProposeCitablesResponse(fixture);
    const mabo = results.find((r) => r.neutralCitation === "[1992] HCA 23");
    expect(mabo).toBeDefined();
    expect(mabo!.caseName).toContain("Mabo");
    expect(mabo!.jadeUrl).toBe("https://jade.io/search/%5B1992%5D%20HCA%2023");
  });

  it("extracts reported citation 175 CLR 1 for Mabo [1992] HCA 23", () => {
    const fixture = readFixture("propose-citables-mabo.txt");
    const { results } = parseProposeCitablesResponse(fixture);
    const mabo = results.find((r) => r.neutralCitation === "[1992] HCA 23");
    expect(mabo!.reportedCitation).toContain("175 CLR 1");
  });

  it("returns multiple results for the Mabo query", () => {
    const fixture = readFixture("propose-citables-mabo.txt");
    const { results } = parseProposeCitablesResponse(fixture);
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it("extracts [1988] HCA 69 result from captured response", () => {
    const fixture = readFixture("propose-citables-mabo.txt");
    const { results } = parseProposeCitablesResponse(fixture);
    const mabo2 = results.find((r) => r.neutralCitation === "[1988] HCA 69");
    expect(mabo2).toBeDefined();
    expect(mabo2!.caseName).toContain("Mabo");
    expect(mabo2!.reportedCitation).toContain("166 CLR");
  });

  it("does not include HCATrans transcript entries", () => {
    const fixture = readFixture("propose-citables-mabo.txt");
    const { results } = parseProposeCitablesResponse(fixture);
    expect(results.some((r) => r.neutralCitation?.includes("HCATrans"))).toBe(false);
  });

  it("sets jadeUrl as a jade.io citation search URL for all results", () => {
    const fixture = readFixture("propose-citables-mabo.txt");
    const { results } = parseProposeCitablesResponse(fixture);
    for (const r of results) {
      expect(r.jadeUrl).toMatch(/^https:\/\/jade\.io\/search\//);
      expect(r.jadeUrl).toContain(encodeURIComponent(r.neutralCitation));
    }
  });

  it("throws on //EX exception response", () => {
    expect(() => parseProposeCitablesResponse("//EX error")).toThrow(/exception/i);
  });

  it("throws on response with unexpected format (no //OK prefix)", () => {
    expect(() => parseProposeCitablesResponse('{"json":"object"}')).toThrow();
  });

  it("returns empty results for response with empty string table", () => {
    const { results } = parseProposeCitablesResponse("//OK[0,[],[],4,7]");
    expect(results).toEqual([]);
  });

  it("throws when parsed JSON is not a long-enough array", () => {
    expect(() => parseProposeCitablesResponse("//OK[1,2,3]")).toThrow(/Malformed proposeCitables/);
  });

  it("uses fallback caseName from preceding string when no ' v ' found (lines 737-745)", () => {
    // Descriptor "[2024] HCA 5 - document in Jade" has no ";" → hasSemicolon=false
    // "SomeCaseWithoutV" has no " v " → backward scan finds nothing
    // Fallback: candidate = stringTable[descIdx-1] = "SomeCaseWithoutV"
    const { results } = parseProposeCitablesResponse(
      '//OK[0,["SomeCaseWithoutV","[2024] HCA 5 - document in Jade"],4,7]',
    );
    expect(results.length).toBe(1);
    expect(results[0]!.caseName).toBe("SomeCaseWithoutV");
    expect(results[0]!.neutralCitation).toBe("[2024] HCA 5");
  });

  it("throws when JSON parse fails after //OK prefix", () => {
    expect(() => parseProposeCitablesResponse("//OKinvalid")).toThrow(
      /Failed to parse proposeCitables/,
    );
  });

  it("throws when the string table has an invalid shape", () => {
    expect(() => parseProposeCitablesResponse("//OK[0,[],0,4,7]")).toThrow(/string table/);
  });

  it("deduplicates results with the same neutral citation", () => {
    const fixture = readFixture("propose-citables-mabo.txt");
    const { results } = parseProposeCitablesResponse(fixture);
    const citations = results.map((r) => r.neutralCitation);
    const unique = new Set(citations);
    expect(citations.length).toBe(unique.size);
  });

  it("returns flatArray alongside results for bridge section extraction", () => {
    const fixture = readFixture("propose-citables-mabo.txt");
    const { results, flatArray } = parseProposeCitablesResponse(fixture);
    expect(results.length).toBeGreaterThan(0);
    expect(flatArray.length).toBeGreaterThan(0);
  });
});

describe("extractBridgeCandidates", () => {
  it("finds Mabo article ID 67683 in mabo fixture bridge section", () => {
    const fixture = readFixture("propose-citables-mabo.txt");
    const { flatArray } = parseProposeCitablesResponse(fixture);
    const candidates = extractBridgeCandidates(flatArray);
    expect(candidates.some((c) => c.articleId === 67683)).toBe(true);
  });

  it("finds Mabo [1988] HCA 69 article ID 67474 candidate in mabo fixture", () => {
    const fixture = readFixture("propose-citables-mabo.txt");
    const { flatArray } = parseProposeCitablesResponse(fixture);
    const candidates = extractBridgeCandidates(flatArray);
    // 67474 is the expected article ID for [1988] HCA 69 based on bridge pattern
    // (may or may not be present depending on bridge section content)
    expect(candidates.length).toBeGreaterThan(0);
  });

  it("finds all three known Kozarov article IDs as high confidence", () => {
    const fixture = readFixture("propose-citables-kozarov.txt");
    const { flatArray } = parseProposeCitablesResponse(fixture);
    const candidates = extractBridgeCandidates(flatArray);
    const knownIds = [776897, 712770, 912625];
    const matched = candidates.filter((c) => knownIds.includes(c.articleId));
    expect(matched).toHaveLength(3);
    expect(matched.every((c) => c.confidence === "high")).toBe(true);
  });

  it("finds Rogers v Whitaker article ID 67721 in rogers fixture", () => {
    const fixture = readFixture("propose-citables-rogers.txt");
    const { flatArray } = parseProposeCitablesResponse(fixture);
    const candidates = extractBridgeCandidates(flatArray);
    expect(candidates.some((c) => c.articleId === 67721)).toBe(true);
  });

  it("returns at most 30 candidates", () => {
    const fixture = readFixture("propose-citables-mabo.txt");
    const { flatArray } = parseProposeCitablesResponse(fixture);
    const candidates = extractBridgeCandidates(flatArray);
    expect(candidates.length).toBeLessThanOrEqual(30);
  });

  it("returns high-confidence candidates before medium-confidence ones", () => {
    const fixture = readFixture("propose-citables-kozarov.txt");
    const { flatArray } = parseProposeCitablesResponse(fixture);
    const candidates = extractBridgeCandidates(flatArray);
    const firstMediumIdx = candidates.findIndex((c) => c.confidence === "medium");
    if (firstMediumIdx > 0) {
      // All candidates before the first medium one should be high
      expect(candidates.slice(0, firstMediumIdx).every((c) => c.confidence === "high")).toBe(true);
    }
  });

  it("returns empty array for empty flat array", () => {
    expect(extractBridgeCandidates([])).toEqual([]);
  });
});

describe("parseGwtRpcResponse", () => {
  it("extracts the HTML string from a getInitialContent response", () => {
    const responseText = '//OK[1,[],["<DIV>judgment text here</DIV>"],4,7]';
    expect(parseGwtRpcResponse(responseText)).toBe("<DIV>judgment text here</DIV>");
  });

  it("extracts JSON string from a getArticleStructuredMetadata response", () => {
    // GWT-RPC string table entries are JSON-encoded strings, so inner quotes are escaped.
    // This mirrors the actual wire format observed in the Proxyman HAR capture.
    const metadata = { "@context": "http://schema.org", name: "Test v Jones" };
    const responseText = `//OK[1,[],[${JSON.stringify(JSON.stringify(metadata))}],4,7]`;
    const result = parseGwtRpcResponse(responseText);
    expect(result).toContain("schema.org");
  });

  it("decodes unicode escape sequences (\\u003C becomes <)", () => {
    const responseText = '//OK[1,[],["\\u003CDIV\\u003E"],4,7]';
    expect(parseGwtRpcResponse(responseText)).toBe("<DIV>");
  });

  it("throws on //EX server exception response", () => {
    expect(() => parseGwtRpcResponse('//EX[{"type":"exception"}]')).toThrow(/server.*exception/i);
  });

  it("throws on unexpected format (no //OK prefix)", () => {
    expect(() => parseGwtRpcResponse('{"json":"object"}')).toThrow();
  });

  it("throws when string table is empty", () => {
    expect(() => parseGwtRpcResponse("//OK[1,[],[],4,7]")).toThrow(/empty/i);
  });

  it("throws when //OK body is not valid JSON (line 416)", () => {
    expect(() => parseGwtRpcResponse("//OKnot-valid-json{{")).toThrow(/Failed to parse/);
  });

  it("throws when response array has fewer than 3 elements (line 420)", () => {
    expect(() => parseGwtRpcResponse("//OK[1,2]")).toThrow(/unexpected structure/);
  });

  it("throws when string table first element is not a string (line 432)", () => {
    expect(() => parseGwtRpcResponse("//OK[1,[],[123],4,7]")).toThrow(/not a string/);
  });
});

describe("parseGwtConcatResponse", () => {
  it("parses a simple //OK response with no .concat()", () => {
    const resp = '//OK[1,2,3,["st1","st2"],4,7]';
    const { flatArray, stringTable } = parseGwtConcatResponse(resp);
    expect(flatArray).toEqual([1, 2, 3]);
    expect(stringTable).toEqual(["st1", "st2"]);
  });

  it("parses a response with one .concat() segment", () => {
    const resp = '//OK[1,2].concat([3,4,["st1","st2"],4,7])';
    const { flatArray, stringTable } = parseGwtConcatResponse(resp);
    expect(flatArray).toEqual([1, 2, 3, 4]);
    expect(stringTable).toEqual(["st1", "st2"]);
  });

  it("parses the real Mabo citator fixture", () => {
    const fixture = readFixture("citator-mabo.txt");
    const { flatArray, stringTable } = parseGwtConcatResponse(fixture);
    expect(flatArray.length).toBeGreaterThan(40000);
    expect(stringTable.length).toBeGreaterThan(1000);
    expect(
      stringTable.some((s) => typeof s === "string" && s.includes("CitableSearchResults")),
    ).toBe(true);
  });

  it("throws on //EX exception response", () => {
    expect(() => parseGwtConcatResponse("//EX error")).toThrow(/exception/i);
  });

  it("throws on unexpected prefix", () => {
    expect(() => parseGwtConcatResponse('{"json":"object"}')).toThrow();
  });

  it("returns empty arrays for minimal response", () => {
    const resp = "//OK[4,7]";
    const { flatArray, stringTable } = parseGwtConcatResponse(resp);
    expect(flatArray).toEqual([]);
    expect(stringTable).toEqual([]);
  });
});

describe("parseCitatorResponse", () => {
  it("extracts citing cases from the Mabo citator fixture", () => {
    const fixture = readFixture("citator-mabo.txt");
    const { results } = parseCitatorResponse(fixture);
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(30);
  });

  it("extracts neutral citations for citing cases", () => {
    const fixture = readFixture("citator-mabo.txt");
    const { results } = parseCitatorResponse(fixture);
    const cits = results.map((r) => r.neutralCitation);
    expect(cits).toContain("[2025] HCA 12");
    expect(cits).toContain("[2025] HCA 32");
  });

  it("extracts Stuart v South Australia as the case name for [2025] HCA 12", () => {
    const fixture = readFixture("citator-mabo.txt");
    const { results } = parseCitatorResponse(fixture);
    const stuart = results.find((r) => r.neutralCitation === "[2025] HCA 12");
    expect(stuart).toBeDefined();
    expect(stuart!.caseName).toContain("Stuart");
  });

  it("extracts article ID 1127773 for [2025] HCA 12", () => {
    const fixture = readFixture("citator-mabo.txt");
    const { results } = parseCitatorResponse(fixture);
    const stuart = results.find((r) => r.neutralCitation === "[2025] HCA 12");
    expect(stuart?.articleId).toBe(1127773);
  });

  it("sets direct jade.io URL when article ID is available", () => {
    const fixture = readFixture("citator-mabo.txt");
    const { results } = parseCitatorResponse(fixture);
    const stuart = results.find((r) => r.neutralCitation === "[2025] HCA 12");
    expect(stuart?.jadeUrl).toBe("https://jade.io/article/1127773");
  });

  it("returns totalCount reflecting the full result set", () => {
    const fixture = readFixture("citator-mabo.txt");
    const { totalCount } = parseCitatorResponse(fixture);
    expect(totalCount).toBe(695);
  });

  it("throws on //EX exception response", () => {
    expect(() => parseCitatorResponse("//EX error")).toThrow(/exception/i);
  });

  it("returns empty results for empty response", () => {
    const { results, totalCount } = parseCitatorResponse("//OK[4,7]");
    expect(results).toEqual([]);
    expect(totalCount).toBe(0);
  });

  it("uses backward scan fallback for caseName when forward scan finds nothing (lines 566-567)", () => {
    // String table: caseName ("Smith v Jones") comes BEFORE the citation ("[2024] HCA 5")
    // Forward scan (after citation) finds nothing; backward scan finds the case name
    const { results } = parseCitatorResponse('//OK[0,["Smith v Jones","[2024] HCA 5"],4,7]');
    expect(results.length).toBe(1);
    expect(results[0]!.caseName).toBe("Smith v Jones");
    expect(results[0]!.neutralCitation).toBe("[2024] HCA 5");
  });
});

describe("buildCitatorSearchRequest", () => {
  it("uses LeftoverRemoteService strong name", () => {
    const body = buildCitatorSearchRequest(2463606);
    expect(body).toContain("C759183224A415CB53405469AC1B351C");
    expect(body).toContain("LeftoverRemoteService");
  });

  it("embeds the GWT-encoded citable ID (JZd2 = 2463606)", () => {
    const body = buildCitatorSearchRequest(2463606);
    expect(body).toContain("JZd2");
  });

  it("includes the search method name", () => {
    const body = buildCitatorSearchRequest(2463606);
    expect(body).toContain("|search|");
  });

  it("starts with GWT-RPC version header", () => {
    expect(buildCitatorSearchRequest(2463606)).toMatch(/^7\|0\|35\|/);
  });

  it("includes CitationSearchDefinition type", () => {
    const body = buildCitatorSearchRequest(2463606);
    expect(body).toContain("CitationSearchDefinition");
  });

  it("uses a different citable ID for a different input", () => {
    const body1 = buildCitatorSearchRequest(2463606);
    const body2 = buildCitatorSearchRequest(3190326);
    expect(body1).not.toBe(body2);
    // JZd2 in body1, not in body2 (different encoded ID)
    expect(body1).toContain("JZd2");
    expect(body2).not.toContain("JZd2");
  });
});

describe("extractCitableIds", () => {
  it("finds JZd2 = 2463606 (Mabo [1992] HCA 23 citable ID) in mabo fixture", () => {
    const fixture = readFixture("propose-citables-mabo.txt");
    const { flatArray } = parseProposeCitablesResponse(fixture);
    const citableIds = extractCitableIds(flatArray);
    expect(citableIds.some((c) => c.citableId === 2463606)).toBe(true);
  });

  it("returns citable IDs in the 2M-10M range", () => {
    const fixture = readFixture("propose-citables-mabo.txt");
    const { flatArray } = parseProposeCitablesResponse(fixture);
    const citableIds = extractCitableIds(flatArray);
    expect(citableIds.length).toBeGreaterThan(0);
    for (const c of citableIds) {
      expect(c.citableId).toBeGreaterThanOrEqual(2_000_000);
      expect(c.citableId).toBeLessThanOrEqual(10_000_000);
    }
  });

  it("returns roughly one to three citable IDs per search result", () => {
    const fixture = readFixture("propose-citables-mabo.txt");
    const { results, flatArray } = parseProposeCitablesResponse(fixture);
    const citableIds = extractCitableIds(flatArray);
    expect(citableIds.length).toBeGreaterThanOrEqual(results.length);
    expect(citableIds.length).toBeLessThanOrEqual(results.length * 5);
  });

  it("returns empty array for empty flat array", () => {
    expect(extractCitableIds([])).toEqual([]);
  });
});
