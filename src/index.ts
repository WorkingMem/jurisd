import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { formatFetchResponse, formatSearchResults } from "./utils/formatter.js";
import { fetchDocumentText } from "./services/fetcher.js";
import { searchAustLii, type SearchResult } from "./services/austlii.js";
import {
  resolveArticle,
  resolveArticleFromUrl,
  articleToSearchResult,
  enrichWithSourceLinks,
  isSourceUrl,
  buildCitationLookupUrl,
} from "./services/source.js";
import {
  formatAGLC4,
  validateCitation,
  parseCitation,
  generatePinpoint,
} from "./services/citation.js";

const formatEnum = z.enum(["json", "text", "markdown", "html"]).default("json");
const jurisdictionEnum = z.enum([
  "cth",
  "vic",
  "nsw",
  "qld",
  "sa",
  "wa",
  "tas",
  "nt",
  "act",
  "federal",
  "nz",
  "other",
]);
const sortByEnum = z.enum(["relevance", "date", "auto"]).default("auto");
const caseMethodEnum = z.enum(["auto", "title", "phrase", "all", "any", "near", "boolean"]).default("auto");
const legislationMethodEnum = z.enum(["auto", "title", "phrase", "all", "any", "near", "legis", "boolean"]).default("auto");

async function main() {
  const server = new McpServer({
    name: "auslaw-mcp",
    version: "0.1.0",
    description: "Australian legislation and case law searcher with OCR-aware document retrieval.",
  });

  const searchLegislationShape = {
    query: z.string().min(1, "Query cannot be empty."),
    jurisdiction: jurisdictionEnum.optional(),
    limit: z.number().int().min(1).max(50).optional(),
    format: formatEnum.optional(),
    sortBy: sortByEnum.optional(),
    method: legislationMethodEnum.optional(),
    offset: z.number().int().min(0).max(500).optional(),
  };
  const searchLegislationParser = z.object(searchLegislationShape);

  server.registerTool(
    "search_legislation",
    {
      title: "Search Legislation",
      description:
        "Search Australian and New Zealand legislation. Jurisdictions: cth, vic, nsw, qld, sa, wa, tas, nt, act, federal, nz, other (all). Methods: auto, title (titles only), phrase (exact match), all (all words), any (any word), near (proximity), legis (legislation names). Use offset for pagination.",
      inputSchema: searchLegislationShape,
    },
    async (rawInput) => {
      const { query, jurisdiction, limit, format, sortBy, method, offset } =
        searchLegislationParser.parse(rawInput);
      const results = await searchAustLii(query, {
        type: "legislation",
        jurisdiction,
        limit,
        sortBy,
        method,
        offset,
      });
      return formatSearchResults(results, format ?? "json");
    },
  );

  const searchCasesShape = {
    query: z.string().min(1, "Query cannot be empty."),
    jurisdiction: jurisdictionEnum.optional(),
    limit: z.number().int().min(1).max(50).optional(),
    format: formatEnum.optional(),
    sortBy: sortByEnum.optional(),
    method: caseMethodEnum.optional(),
    offset: z.number().int().min(0).max(500).optional(),
  };
  const searchCasesParser = z.object(searchCasesShape);

  server.registerTool(
    "search_cases",
    {
      title: "Search Cases",
      description:
        "Search Australian and New Zealand case law. Jurisdictions: cth, vic, nsw, qld, sa, wa, tas, nt, act, federal, nz, other (all). Methods: auto, title (case names only), phrase (exact match), all (all words), any (any word), near (proximity), boolean. Sorting: auto (smart detection), relevance, date. Use offset for pagination (e.g., offset=50 for page 2).",
      inputSchema: searchCasesShape,
    },
    async (rawInput) => {
      const { query, jurisdiction, limit, format, sortBy, method, offset } =
        searchCasesParser.parse(rawInput);
      const results = await searchAustLii(query, {
        type: "case",
        jurisdiction,
        limit,
        sortBy,
        method,
        offset,
      });
      return formatSearchResults(results, format ?? "json");
    },
  );

  const fetchDocumentShape = {
    url: z.string().url("URL must be valid."),
    format: formatEnum.optional(),
  };
  const fetchDocumentParser = z.object(fetchDocumentShape);

  server.registerTool(
    "fetch_document_text",
    {
      title: "Fetch Document Text",
      description:
        "Fetch full text for a legislation or case URL (AustLII or removed.invalid), with OCR fallback for scanned PDFs.",
      inputSchema: fetchDocumentShape,
    },
    async (rawInput) => {
      const { url, format } = fetchDocumentParser.parse(rawInput);
      const response = await fetchDocumentText(url);
      return formatFetchResponse(response, format ?? "json");
    },
  );

  const resolveSourceArticleShape = {
    articleId: z.number().int().min(1, "Article ID must be a positive integer."),
  };
  const resolveSourceArticleParser = z.object(resolveSourceArticleShape);

  server.registerTool(
    "resolve_source_article",
    {
      title: "Resolve removed.invalid Article",
      description:
        "Resolve metadata for a removed.invalid article by its numeric ID. Returns case name, neutral citation, jurisdiction, and year. Useful for looking up specific articles on removed.invalid (Upstream Source).",
      inputSchema: resolveSourceArticleShape,
    },
    async (rawInput) => {
      const { articleId } = resolveSourceArticleParser.parse(rawInput);
      const article = await resolveArticle(articleId);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(article, null, 2),
          },
        ],
      };
    },
  );

  const sourceLookupShape = {
    citation: z.string().min(1, "Citation cannot be empty."),
  };
  const sourceLookupParser = z.object(sourceLookupShape);

  server.registerTool(
    "source_citation_lookup",
    {
      title: "Look up Citation on removed.invalid",
      description:
        "Generate a removed.invalid lookup URL for a given neutral citation (e.g. '[2008] NSWSC 323'). Returns a URL that opens removed.invalid with the citation search. removed.invalid does not expose a public search API, so this provides a direct link for the user.",
      inputSchema: sourceLookupShape,
    },
    async (rawInput) => {
      const { citation } = sourceLookupParser.parse(rawInput);
      const lookupUrl = buildCitationLookupUrl(citation);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { citation, sourceUrl: lookupUrl },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ── format_citation ──────────────────────────────────────────────────────
  const formatCitationShape = {
    title: z.string().min(1).describe("Case name, e.g. 'Mabo v Queensland (No 2)'"),
    neutralCitation: z.string().optional().describe("Neutral citation, e.g. '[1992] HCA 23'"),
    reportedCitation: z.string().optional().describe("Reported citation, e.g. '(1992) 175 CLR 1'"),
    pinpoint: z.string().optional().describe("Pinpoint reference, e.g. '[20]'"),
    style: z.enum(["neutral", "reported", "combined"]).default("combined").describe(
      "Citation style: neutral (neutral only), reported (reported only), combined (both)"
    ),
  };
  const formatCitationParser = z.object(formatCitationShape);

  server.registerTool(
    "format_citation",
    {
      title: "Format AGLC4 Citation",
      description:
        "Format an Australian case citation according to AGLC4 rules. Combines case name, neutral citation, reported citation, and optional pinpoint into the correct format.",
      inputSchema: formatCitationShape,
    },
    async (rawInput) => {
      const { title, neutralCitation, reportedCitation, pinpoint, style } =
        formatCitationParser.parse(rawInput);

      const info = {
        title,
        neutralCitation: style !== "reported" ? neutralCitation : undefined,
        reportedCitation: style !== "neutral" ? reportedCitation : undefined,
        pinpoint,
      };
      const formatted = formatAGLC4(info);
      return { content: [{ type: "text" as const, text: formatted }] };
    },
  );

  // ── validate_citation ─────────────────────────────────────────────────────
  const validateCitationShape = {
    citation: z.string().min(1).describe("Neutral citation to validate, e.g. '[1992] HCA 23'"),
  };
  const validateCitationParser = z.object(validateCitationShape);

  server.registerTool(
    "validate_citation",
    {
      title: "Validate Citation Against AustLII",
      description:
        "Validate a neutral citation by checking it exists on AustLII. Returns the canonical URL if valid.",
      inputSchema: validateCitationShape,
    },
    async (rawInput) => {
      const { citation } = validateCitationParser.parse(rawInput);
      const result = await validateCitation(citation);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // ── generate_pinpoint ─────────────────────────────────────────────────────
  const generatePinpointShape = {
    url: z.string().url().describe("AustLII document URL to fetch and search"),
    paragraphNumber: z.number().int().positive().optional().describe("Paragraph number to locate"),
    phrase: z.string().min(1).optional().describe("Phrase to search for within paragraphs"),
    caseCitation: z.string().optional().describe(
      "Case citation to prepend to the pinpoint, e.g. '[2022] FedCFamC2F 786'"
    ),
  };
  const generatePinpointParser = z.object(generatePinpointShape).refine(
    (d) => d.paragraphNumber !== undefined || d.phrase !== undefined,
    "Provide at least one of paragraphNumber or phrase",
  );

  server.registerTool(
    "generate_pinpoint",
    {
      title: "Generate Pinpoint Citation",
      description:
        "Fetch a judgment from AustLII and generate a pinpoint citation to a specific paragraph (by number or by searching for a phrase).",
      inputSchema: generatePinpointShape,
    },
    async (rawInput) => {
      const { url, paragraphNumber, phrase, caseCitation } =
        generatePinpointParser.parse(rawInput);
      const doc = await fetchDocumentText(url);
      if (!doc.paragraphs || doc.paragraphs.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: "No paragraph blocks found in document" }),
          }],
        };
      }
      const pinpoint = generatePinpoint(doc.paragraphs, { paragraphNumber, phrase });
      if (!pinpoint) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: "Paragraph not found" }),
          }],
        };
      }
      const fullCitation = caseCitation
        ? `${caseCitation} ${pinpoint.pinpointString}`
        : pinpoint.pinpointString;
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ ...pinpoint, fullCitation }, null, 2),
        }],
      };
    },
  );

  // ── search_by_citation ────────────────────────────────────────────────────
  const searchByCitationShape = {
    citation: z.string().min(1).describe("Citation to search for, e.g. '[1992] HCA 23' or 'Mabo v Queensland'"),
    format: formatEnum.optional(),
  };
  const searchByCitationParser = z.object(searchByCitationShape);

  server.registerTool(
    "search_by_citation",
    {
      title: "Search by Citation",
      description:
        "Find a case by its citation. If a neutral citation is detected, validates it against AustLII and returns the direct URL. Otherwise performs a case name search.",
      inputSchema: searchByCitationShape,
    },
    async (rawInput) => {
      const { citation, format } = searchByCitationParser.parse(rawInput);
      const parsed = parseCitation(citation);

      if (parsed?.neutralCitation) {
        const validated = await validateCitation(parsed.neutralCitation);
        if (validated.valid && validated.austliiUrl) {
          const result: SearchResult = {
            title: citation,
            neutralCitation: parsed.neutralCitation,
            url: validated.austliiUrl,
            source: "austlii",
            type: "case",
          };
          return formatSearchResults([result], format ?? "json");
        }
      }

      // Fall back to text search
      const results = await searchAustLii(citation, {
        type: "case",
        sortBy: "relevance",
        limit: 5,
      });
      return formatSearchResults(results, format ?? "json");
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal server error", error);
  process.exit(1);
});
