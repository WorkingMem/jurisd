import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { formatFetchResponse, formatSearchResults } from "./utils/formatter.js";
import { fetchDocumentText } from "./services/fetcher.js";
import { searchAustLii } from "./services/austlii.js";
import {
  resolveArticle,
  buildCitationLookupUrl,
  searchUpstream,
  searchUpstreamByCitation,
  mergeSearchResults,
} from "./services/source.js";

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
const caseMethodEnum = z
  .enum(["auto", "title", "phrase", "all", "any", "near", "boolean"])
  .default("auto");
const legislationMethodEnum = z
  .enum(["auto", "title", "phrase", "all", "any", "near", "legis", "boolean"])
  .default("auto");

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
    includeSource: z.boolean().optional(),
  };
  const searchLegislationParser = z.object(searchLegislationShape);

  server.registerTool(
    "search_legislation",
    {
      title: "Search Legislation",
      description:
        "Search Australian and New Zealand legislation. Jurisdictions: cth, vic, nsw, qld, sa, wa, tas, nt, act, federal, nz, other (all). Methods: auto, title (titles only), phrase (exact match), all (all words), any (any word), near (proximity), legis (legislation names). Use offset for pagination. Set includeSource=true to also search removed.invalid and merge results.",
      inputSchema: searchLegislationShape,
    },
    async (rawInput) => {
      const { query, jurisdiction, limit, format, sortBy, method, offset, includeSource } =
        searchLegislationParser.parse(rawInput);
      const options = {
        type: "legislation" as const,
        jurisdiction,
        limit,
        sortBy,
        method,
        offset,
      };
      const austliiResults = await searchAustLii(query, options);

      if (includeSource) {
        const upstreamResults = await searchUpstream(query, options);
        const merged = mergeSearchResults(austliiResults, upstreamResults);
        return formatSearchResults(merged, format ?? "json");
      }

      return formatSearchResults(austliiResults, format ?? "json");
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
    includeSource: z.boolean().optional(),
  };
  const searchCasesParser = z.object(searchCasesShape);

  server.registerTool(
    "search_cases",
    {
      title: "Search Cases",
      description:
        "Search Australian and New Zealand case law. Jurisdictions: cth, vic, nsw, qld, sa, wa, tas, nt, act, federal, nz, other (all). Methods: auto, title (case names only), phrase (exact match), all (all words), any (any word), near (proximity), boolean. Sorting: auto (smart detection), relevance, date. Use offset for pagination (e.g., offset=50 for page 2). Set includeSource=true to also search removed.invalid (Upstream Source) and merge results.",
      inputSchema: searchCasesShape,
    },
    async (rawInput) => {
      const { query, jurisdiction, limit, format, sortBy, method, offset, includeSource } =
        searchCasesParser.parse(rawInput);
      const options = {
        type: "case" as const,
        jurisdiction,
        limit,
        sortBy,
        method,
        offset,
      };
      const austliiResults = await searchAustLii(query, options);

      if (includeSource) {
        const upstreamResults = await searchUpstream(query, options);
        const merged = mergeSearchResults(austliiResults, upstreamResults);
        return formatSearchResults(merged, format ?? "json");
      }

      return formatSearchResults(austliiResults, format ?? "json");
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
            text: JSON.stringify({ citation, sourceUrl: lookupUrl }, null, 2),
          },
        ],
      };
    },
  );

  const searchUpstreamShape = {
    query: z.string().min(1, "Query cannot be empty."),
    jurisdiction: jurisdictionEnum.optional(),
    limit: z.number().int().min(1).max(50).optional(),
    format: formatEnum.optional(),
    sortBy: sortByEnum.optional(),
    type: z.enum(["case", "legislation"]).default("case"),
  };
  const searchUpstreamParser = z.object(searchUpstreamShape);

  server.registerTool(
    "search_source",
    {
      title: "Search removed.invalid (Upstream Source)",
      description:
        "Search Australian legal materials on removed.invalid (Upstream Source). Works without API access by cross-referencing AustLII search results with removed.invalid article metadata. Returns results with removed.invalid URLs when articles are found. Best for finding cases with removed.invalid links. For direct citation lookup, use search_source_by_citation instead.",
      inputSchema: searchUpstreamShape,
    },
    async (rawInput) => {
      const { query, jurisdiction, limit, format, sortBy, type } = searchUpstreamParser.parse(rawInput);
      const results = await searchUpstream(query, {
        type,
        jurisdiction,
        limit,
        sortBy,
      });
      return formatSearchResults(results, format ?? "json");
    },
  );

  const searchUpstreamByCitationShape = {
    citation: z.string().min(1, "Citation cannot be empty."),
    format: formatEnum.optional(),
  };
  const searchUpstreamByCitationParser = z.object(searchUpstreamByCitationShape);

  server.registerTool(
    "search_source_by_citation",
    {
      title: "Find removed.invalid Article by Citation",
      description:
        "Find a removed.invalid article by its neutral citation (e.g. '[2008] NSWSC 323', '[1992] HCA 23'). Resolves article metadata including case name, jurisdiction, and year from removed.invalid. Returns the removed.invalid article URL if found.",
      inputSchema: searchUpstreamByCitationShape,
    },
    async (rawInput) => {
      const { citation, format } = searchUpstreamByCitationParser.parse(rawInput);
      const article = await searchUpstreamByCitation(citation);
      if (!article) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { citation, found: false, message: "No removed.invalid article found for this citation." },
                null,
                2,
              ),
            },
          ],
        };
      }
      if (format === "text" || format === "markdown") {
        return {
          content: [
            {
              type: "text" as const,
              text: `${article.title}\nCitation: ${article.neutralCitation ?? "N/A"}\nURL: ${article.url}\nJurisdiction: ${article.jurisdiction ?? "N/A"}\nYear: ${article.year ?? "N/A"}`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ citation, found: true, article }, null, 2),
          },
        ],
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal server error", error);
  process.exit(1);
});
