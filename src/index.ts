#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { z } from "zod";

import path from "node:path";
import { formatFetchResponse, formatSearchResults } from "./utils/formatter.js";
import { fetchDocumentText } from "./services/fetcher.js";
import { searchAustLii, type SearchResult } from "./services/austlii.js";
import { mergeCaseSearchResults } from "./services/search-merge.js";
import {
  resolveArticle,
  buildCitationLookupUrl,
  searchUpstream,
  searchCitingCases,
} from "./services/source.js";
import {
  formatAGLC4,
  formatShortForm,
  validateCitation,
  parseCitation,
  generatePinpoint,
  normaliseCitation,
} from "./services/citation.js";
import {
  NEUTRAL_CITATION_PATTERN,
  COURT_TO_AUSTLII_PATH,
  AUSLAW_CACHE_DIR_NAME,
} from "./constants.js";
import {
  upsertCitation,
  getCitation,
  listCitations,
  exportBib,
  updateSourceFields,
  updateCitedBy,
  updateCitedBySource,
  type CitedByRef,
} from "./services/citation-cache.js";
import { storeSource, checkSourceFreshness } from "./services/source-store.js";
import { config } from "./config.js";

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

/**
 * Derive an AustLII URL from a neutral citation without a network call.
 * Returns undefined when the court code is not in COURT_TO_AUSTLII_PATH.
 */
function austliiUrlFromNeutral(neutralCitation: string): string | undefined {
  const m = normaliseCitation(neutralCitation).match(NEUTRAL_CITATION_PATTERN);
  if (!m) return undefined;
  const [, year, court, num] = m;
  const austliiPath = COURT_TO_AUSTLII_PATH[court!];
  if (!austliiPath) return undefined;
  return `https://www.austlii.edu.au/cgi-bin/viewdoc/${austliiPath}/${year}/${num}.html`;
}

/**
 * Build a filesystem-safe key for a cited-by source file.
 * e.g. parent "mabo1992" + "[2024] HCA 5" → "mabo1992_citing_2024_hca_5"
 */
function citedBySourceKey(parentCiteKey: string, neutralCitation: string): string {
  const slug = neutralCitation
    .replace(/[[\]]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
  return `${parentCiteKey}_citing_${slug}`;
}

/**
 * Build a fresh McpServer with all tools registered.
 *
 * In stateless HTTP mode (`sessionIdGenerator: undefined`), each request
 * requires its own server + transport instance because
 * `StreamableHTTPServerTransport` tracks per-request state on the Response
 * object. Reusing a single server/transport across requests throws
 * "Transport is already started" or silently corrupts the state machine.
 */
function createMcpServer(): McpServer {
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

      // Run AustLII and removed.invalid searches in parallel
      const [austliiResults, upstreamResults] = await Promise.all([
        searchAustLii(query, { type: "case", jurisdiction, limit, sortBy, method, offset }),
        searchUpstream(query, { type: "case", jurisdiction, limit }),
      ]);

      const merged = mergeCaseSearchResults(austliiResults, upstreamResults, limit);

      return formatSearchResults(merged, format ?? "json");
    },
  );

  const fetchDocumentShape = {
    url: z.string().url("URL must be valid."),
    format: formatEnum.optional(),
    citeKey: z
      .string()
      .optional()
      .describe(
        "Cite key of an existing cache entry to associate with this fetch (updates source fields).",
      ),
  };
  const fetchDocumentParser = z.object(fetchDocumentShape);

  server.registerTool(
    "fetch_document_text",
    {
      title: "Fetch Document Text",
      description:
        "Fetch full text for a legislation or case URL (AustLII or removed.invalid), with OCR fallback for scanned PDFs. When a `citeKey` is supplied and AUSLAW_FETCH_SOURCES is not set to 'false', also saves a local markdown copy to the sources directory and updates the cache entry's HTTP freshness headers. Without `citeKey`, only the document text is returned.",
      inputSchema: fetchDocumentShape,
    },
    async (rawInput) => {
      const { url, format, citeKey } = fetchDocumentParser.parse(rawInput);
      const response = await fetchDocumentText(url);

      // Auto-store source when enabled and a citeKey is provided or fetchByDefault is on
      if (config.sources.fetchByDefault && citeKey) {
        try {
          const existing = await getCitation(config.cache.dir, citeKey);
          const storeResult = await storeSource(
            citeKey,
            url,
            existing,
            config.sources.dir,
            response,
          );
          const relPath = path.relative(config.cache.dir, storeResult.path);
          await updateSourceFields(config.cache.dir, citeKey, {
            sourceFile: relPath,
            contentHash: storeResult.contentHash,
            sourceFetchedAt: new Date().toISOString(),
            sourceEtag: storeResult.etag,
            sourceLastModified: storeResult.lastModified,
          });
        } catch {
          // Source storage is best-effort — don't fail the fetch
        }
      }

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

  // ── format_citation ──────────────────────────────────────────────────────
  const formatCitationShape = {
    title: z.string().min(1).describe("Case name, e.g. 'Mabo v Queensland (No 2)'"),
    neutralCitation: z.string().optional().describe("Neutral citation, e.g. '[1992] HCA 23'"),
    reportedCitation: z.string().optional().describe("Reported citation, e.g. '(1992) 175 CLR 1'"),
    pinpoint: z.string().optional().describe("Pinpoint reference, e.g. '[20]'"),
    style: z
      .enum(["neutral", "reported", "combined"])
      .default("combined")
      .describe(
        "Citation style: neutral (neutral only), reported (reported only), combined (both)",
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
    caseCitation: z
      .string()
      .optional()
      .describe("Case citation to prepend to the pinpoint, e.g. '[2022] FedCFamC2F 786'"),
  };
  const generatePinpointParser = z
    .object(generatePinpointShape)
    .refine(
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
      const { url, paragraphNumber, phrase, caseCitation } = generatePinpointParser.parse(rawInput);
      const doc = await fetchDocumentText(url);
      if (!doc.paragraphs || doc.paragraphs.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "No paragraph blocks found in document" }),
            },
          ],
        };
      }
      const pinpoint = generatePinpoint(doc.paragraphs, { paragraphNumber, phrase });
      if (!pinpoint) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Paragraph not found" }),
            },
          ],
        };
      }
      const fullCitation = caseCitation
        ? `${caseCitation} ${pinpoint.pinpointString}`
        : pinpoint.pinpointString;
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ ...pinpoint, fullCitation }, null, 2),
          },
        ],
      };
    },
  );

  // ── search_by_citation ────────────────────────────────────────────────────
  const searchByCitationShape = {
    citation: z
      .string()
      .min(1)
      .describe("Citation to search for, e.g. '[1992] HCA 23' or 'Mabo v Queensland'"),
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

  // ── search_citing_cases ───────────────────────────────────────────────────
  const searchCitingCasesShape = {
    caseName: z
      .string()
      .min(1)
      .describe(
        "Case name or citation to find citing cases for, e.g. 'Mabo v Queensland (No 2)' or '[1992] HCA 23'",
      ),
    format: formatEnum.optional(),
  };
  const searchCitingCasesParser = z.object(searchCitingCasesShape);

  server.registerTool(
    "search_citing_cases",
    {
      title: "Search Citing Cases (Citator)",
      description:
        "Find cases that cite a given case on removed.invalid. Uses removed.invalid's RemoteService citator. Requires SESSION_COOKIE. Returns citing cases with neutral citations, case names, removed.invalid URLs, and the total count of citing cases. Results are a sample (typically 20-30) of the full set.",
      inputSchema: searchCitingCasesShape,
    },
    async (rawInput) => {
      const { caseName, format } = searchCitingCasesParser.parse(rawInput);
      const { results, totalCount } = await searchCitingCases(caseName);
      const output = { totalCount, results };
      const fmt = format ?? "json";
      if (fmt === "json") {
        return { content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }] };
      }
      // Markdown/text fallback
      const lines = [
        `**${results.length} of ${totalCount} citing cases found**`,
        "",
        ...results.map(
          (r) =>
            `- ${r.caseName} ${r.neutralCitation}${r.reportedCitation ? "; " + r.reportedCitation : ""} — ${r.sourceUrl}`,
        ),
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  // ── cache_citation ────────────────────────────────────────────────────────
  const cacheCitationShape = {
    title: z.string().min(1).describe("Case name, e.g. 'Mabo v Queensland (No 2)'"),
    neutralCitation: z.string().optional().describe("Neutral citation, e.g. '[1992] HCA 23'"),
    reportedCitation: z.string().optional().describe("Reported citation, e.g. '(1992) 175 CLR 1'"),
    url: z.string().url().describe("Primary source URL (AustLII or removed.invalid)"),
    type: z
      .enum(["case", "legislation", "secondary", "treaty"])
      .default("case")
      .describe("Source type"),
    jurisdiction: z.string().optional(),
    year: z.number().int().optional().describe("Decision year"),
    court: z.string().optional().describe("Court code, e.g. 'HCA'"),
    keywords: z.array(z.string()).optional(),
    summary: z.string().optional().describe("Brief abstract of the source"),
    document: z
      .string()
      .optional()
      .describe("Logical document name this citation belongs to, e.g. 'essay-chapter-3'"),
    footnoteNumber: z
      .number()
      .int()
      .optional()
      .describe("Footnote number where this citation first appears in `document`"),
    pinpoint: z
      .string()
      .optional()
      .describe("Pinpoint to include in the AGLC4 full form, e.g. '[20]' or '401 to 407'"),
    style: z
      .enum(["neutral", "reported", "combined"])
      .default("combined")
      .describe("Which citation components to include in aglc4Full"),
  };
  const cacheCitationParser = z.object(cacheCitationShape);

  server.registerTool(
    "cache_citation",
    {
      title: "Cache Citation",
      description:
        "Store or update a citation in the local project cache. Assigns a biblatex-compatible cite key on first use. Returns the cite key and canonical AGLC4 string.",
      inputSchema: cacheCitationShape,
    },
    async (rawInput) => {
      const {
        title,
        neutralCitation,
        reportedCitation,
        url,
        type,
        jurisdiction,
        year,
        court,
        keywords,
        summary,
        document,
        footnoteNumber,
        pinpoint,
        style,
      } = cacheCitationParser.parse(rawInput);

      const aglc4Full = formatAGLC4({
        title,
        neutralCitation: style !== "reported" ? neutralCitation : undefined,
        reportedCitation: style !== "neutral" ? reportedCitation : undefined,
        pinpoint,
      });

      const citeKey = await upsertCitation(config.cache.dir, {
        title,
        neutralCitation,
        reportedCitation,
        aglc4Full,
        url,
        type,
        jurisdiction,
        year,
        court,
        keywords,
        summary,
        document,
        footnoteNumber,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ citeKey, aglc4Full, cached: true }, null, 2),
          },
        ],
      };
    },
  );

  // ── get_cached_citation ───────────────────────────────────────────────────
  const getCachedCitationShape = {
    query: z
      .string()
      .min(1)
      .describe(
        "Cite key (e.g. 'mabo1992'), AGLC4 citation string, neutral citation, or case title",
      ),
  };
  const getCachedCitationParser = z.object(getCachedCitationShape);

  server.registerTool(
    "get_cached_citation",
    {
      title: "Get Cached Citation",
      description:
        "Retrieve a citation from the local cache without any network calls. Looks up by cite key, AGLC4 full string, neutral citation, or case title.",
      inputSchema: getCachedCitationShape,
    },
    async (rawInput) => {
      const { query } = getCachedCitationParser.parse(rawInput);
      const entry = await getCitation(config.cache.dir, query);
      if (!entry) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ found: false, query }) }],
        };
      }
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ found: true, ...entry }, null, 2) },
        ],
      };
    },
  );

  // ── list_bibliography ─────────────────────────────────────────────────────
  const listBibliographyShape = {
    document: z
      .string()
      .optional()
      .describe("Filter to citations used in this document. Omit for all project citations."),
    format: formatEnum.optional(),
  };
  const listBibliographyParser = z.object(listBibliographyShape);

  server.registerTool(
    "list_bibliography",
    {
      title: "List Bibliography",
      description:
        "List all cached citations for this project, optionally filtered to a specific document.",
      inputSchema: listBibliographyShape,
    },
    async (rawInput) => {
      const { document, format } = listBibliographyParser.parse(rawInput);
      const entries = await listCitations(config.cache.dir, document);
      const fmt = format ?? "json";

      if (fmt === "json") {
        return {
          content: [{ type: "text" as const, text: JSON.stringify(entries, null, 2) }],
          structuredContent: { format: "json", data: entries },
        };
      }
      if (fmt === "markdown") {
        const lines = entries.map((e) => `- **${e.citeKey}** — ${e.aglc4Full}`);
        return { content: [{ type: "text" as const, text: lines.join("\n") || "(empty)" }] };
      }
      // text / html
      const lines = entries.map((e, i) => `${i + 1}. [${e.citeKey}] ${e.aglc4Full}`);
      return { content: [{ type: "text" as const, text: lines.join("\n") || "(empty)" }] };
    },
  );

  // ── export_bibliography ───────────────────────────────────────────────────
  const exportBibliographyShape = {
    document: z
      .string()
      .optional()
      .describe("Export only citations used in this document. Omit for all project citations."),
    outputPath: z
      .string()
      .optional()
      .describe(
        "Write the .bib file to this absolute path. Defaults to <cacheDir>/<projectName>.bib",
      ),
  };
  const exportBibliographyParser = z.object(exportBibliographyShape);

  server.registerTool(
    "export_bibliography",
    {
      title: "Export Bibliography (.bib)",
      description:
        "Export cached citations as a BibLaTeX .bib file. Returns the bib text and the path where it was written.",
      inputSchema: exportBibliographyShape,
    },
    async (rawInput) => {
      const { document, outputPath } = exportBibliographyParser.parse(rawInput);
      const bibText = await exportBib(config.cache.dir, document);

      if (!bibText) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ path: null, entries: 0, bib: "" }, null, 2),
            },
          ],
        };
      }

      const defaultPath = path.join(
        config.cache.dir,
        AUSLAW_CACHE_DIR_NAME,
        `${config.cache.projectName}.bib`,
      );
      const writePath = outputPath ?? defaultPath;

      const { promises: fs } = await import("node:fs");
      await fs.mkdir(path.dirname(writePath), { recursive: true });
      await fs.writeFile(writePath, bibText, "utf-8");

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                path: writePath,
                entries: (bibText.match(/^@/gm) ?? []).length,
                bib: bibText,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ── format_short_citation ─────────────────────────────────────────────────
  const formatShortCitationShape = {
    title: z
      .string()
      .min(1)
      .describe("The abbreviated case name chosen at first reference, e.g. 'Mabo'"),
    mode: z
      .enum(["short", "ibid", "subsequent"])
      .default("short")
      .describe(
        "short = plain short form; ibid = Ibid (back-to-back same source); subsequent = title (n X)",
      ),
    footnoteRef: z
      .number()
      .int()
      .optional()
      .describe("Footnote number of first citation — required for 'subsequent' mode"),
    pinpointPara: z.number().int().optional().describe("Paragraph pinpoint number, e.g. 20 → [20]"),
    pinpointPage: z.number().int().optional().describe("Page pinpoint number, e.g. 401"),
  };
  const formatShortCitationParser = z.object(formatShortCitationShape);

  server.registerTool(
    "format_short_citation",
    {
      title: "Format Short-Form Citation",
      description:
        "Format an AGLC4-compliant short-form, Ibid, or subsequent reference. Use 'ibid' when citing the same source as the immediately preceding footnote; 'subsequent' for later references (requires footnoteRef).",
      inputSchema: formatShortCitationShape,
    },
    async (rawInput) => {
      const { title, mode, footnoteRef, pinpointPara, pinpointPage } =
        formatShortCitationParser.parse(rawInput);

      const pinpoint =
        pinpointPara !== undefined
          ? { type: "para" as const, n: pinpointPara }
          : pinpointPage !== undefined
            ? { type: "page" as const, n: pinpointPage }
            : undefined;

      const result = formatShortForm({ title, mode, footnoteRef, pinpoint });
      return { content: [{ type: "text" as const, text: result }] };
    },
  );

  // ── check_source_freshness ────────────────────────────────────────────────
  const checkSourceFreshnessShape = {
    citeKey: z.string().min(1).describe("Cite key of a cached citation, e.g. 'mabo1992'"),
  };
  const checkSourceFreshnessParser = z.object(checkSourceFreshnessShape);

  server.registerTool(
    "check_source_freshness",
    {
      title: "Check Source Freshness",
      description:
        "Check whether the locally cached source file for a citation is still current. Issues a conditional HEAD request using the stored ETag/Last-Modified. If the remote source is newer, downloads and updates the local copy automatically.",
      inputSchema: checkSourceFreshnessShape,
    },
    async (rawInput) => {
      const { citeKey } = checkSourceFreshnessParser.parse(rawInput);
      const entry = await getCitation(config.cache.dir, citeKey);

      if (!entry) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `No cached citation found for key: ${citeKey}` }),
            },
          ],
        };
      }

      if (!entry.sourceEtag && !entry.sourceLastModified && !entry.contentHash) {
        // No source ever fetched — download now
        try {
          const storeResult = await storeSource(citeKey, entry.url, null, config.sources.dir);
          const relPath = path.relative(config.cache.dir, storeResult.path);
          await updateSourceFields(config.cache.dir, citeKey, {
            sourceFile: relPath,
            contentHash: storeResult.contentHash,
            sourceFetchedAt: new Date().toISOString(),
            sourceEtag: storeResult.etag,
            sourceLastModified: storeResult.lastModified,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    fresh: false,
                    changed: true,
                    sourceFile: relPath,
                    note: "Source downloaded for the first time",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: `Failed to download source: ${err instanceof Error ? err.message : String(err)}`,
                }),
              },
            ],
          };
        }
      }

      const freshness = await checkSourceFreshness(
        entry.url,
        entry.sourceEtag,
        entry.sourceLastModified,
      );

      if (!freshness.fresh) {
        // Remote is newer — re-download
        try {
          const storeResult = await storeSource(
            citeKey,
            entry.url,
            { contentHash: entry.contentHash },
            config.sources.dir,
          );
          const relPath = path.relative(config.cache.dir, storeResult.path);
          await updateSourceFields(config.cache.dir, citeKey, {
            sourceFile: relPath,
            contentHash: storeResult.contentHash,
            sourceFetchedAt: new Date().toISOString(),
            sourceEtag: storeResult.etag,
            sourceLastModified: storeResult.lastModified,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { fresh: false, changed: storeResult.changed, sourceFile: relPath },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: `Failed to refresh source: ${err instanceof Error ? err.message : String(err)}`,
                }),
              },
            ],
          };
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                fresh: true,
                changed: false,
                sourceFile: entry.sourceFile,
                lastChecked: new Date().toISOString(),
                etag: freshness.etag ?? entry.sourceEtag,
                lastModified: freshness.lastModified ?? entry.sourceLastModified,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ── cache_cited_by ────────────────────────────────────────────────────────
  const cacheCitedByShape = {
    citeKey: z
      .string()
      .min(1)
      .describe("Cite key of the parent case whose citing cases should be fetched and cached"),
  };
  const cacheCitedByParser = z.object(cacheCitedByShape);

  server.registerTool(
    "cache_cited_by",
    {
      title: "Cache Cited-By Results",
      description:
        "Fetch citing cases for a cached citation from removed.invalid and store them locally. " +
        "Metadata is saved for all results; source files are downloaded for the top N entries " +
        "(controlled by AUSLAW_CITED_BY_DOWNLOAD_LIMIT, default 5). " +
        "Requires SESSION_COOKIE. Can be disabled via AUSLAW_CACHE_CITED_BY=false.",
      inputSchema: cacheCitedByShape,
    },
    async (rawInput) => {
      const { citeKey } = cacheCitedByParser.parse(rawInput);

      if (!config.citedBy.enabled) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "Cited-by caching is disabled (AUSLAW_CACHE_CITED_BY=false)",
              }),
            },
          ],
        };
      }

      const parent = await getCitation(config.cache.dir, citeKey);
      if (!parent) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: `No cached citation found for key: ${citeKey}` }),
            },
          ],
        };
      }

      if (!config.source.sessionCookie) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "SESSION_COOKIE is required to fetch cited-by data",
              }),
            },
          ],
        };
      }

      // Search removed.invalid for cases that cite this one
      const query = parent.neutralCitation ?? parent.title;
      const { results, totalCount } = await searchCitingCases(query);

      // Guard: if the API returns nothing but we have prior data, treat this as
      // a likely failure (bad/expired cookie, network error) rather than a
      // genuine empty set — preserving existing cache instead of erasing it.
      if (results.length === 0 && totalCount === 0 && (parent.citedBy?.length ?? 0) > 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error:
                  "removed.invalid returned no results but existing cited-by data is present. " +
                  "The session cookie may be expired. Existing cache preserved.",
                existingCount: parent.citedBy!.length,
              }),
            },
          ],
        };
      }

      // Snapshot prior source fields so conditional GET (ETag/Last-Modified)
      // works correctly when cache_cited_by is called a second time.
      const priorSources = new Map(
        (parent.citedBy ?? [])
          .filter((r) => r.neutralCitation)
          .map((r) => [r.neutralCitation!, r] as const),
      );

      // Build CitedByRef entries — prefer AustLII URL where derivable
      const refs: CitedByRef[] = results.map((r) => {
        const derivedUrl = r.neutralCitation ? austliiUrlFromNeutral(r.neutralCitation) : undefined;
        const year = r.neutralCitation
          ? parseInt(r.neutralCitation.match(/\[(\d{4})\]/)?.[1] ?? "", 10) || undefined
          : undefined;
        return {
          title: r.caseName,
          neutralCitation: r.neutralCitation || undefined,
          aglc4Full: r.neutralCitation
            ? formatAGLC4({ title: r.caseName, neutralCitation: r.neutralCitation })
            : r.caseName,
          url: derivedUrl ?? r.sourceUrl,
          year,
          court: r.court,
        };
      });

      const now = new Date().toISOString();
      await updateCitedBy(config.cache.dir, citeKey, refs, totalCount, now);

      // Optionally download sources for the top-N refs
      let sourcesDownloaded = 0;
      if (config.citedBy.downloadSources) {
        const toDownload = refs.slice(0, config.citedBy.downloadLimit);
        for (const ref of toDownload) {
          if (!ref.url || !ref.neutralCitation) continue;
          try {
            const fileKey = citedBySourceKey(citeKey, ref.neutralCitation);
            const prior = priorSources.get(ref.neutralCitation) ?? null;
            const storeResult = await storeSource(fileKey, ref.url, prior, config.sources.dir);
            const relPath = path.relative(config.cache.dir, storeResult.path);
            await updateCitedBySource(config.cache.dir, citeKey, ref.neutralCitation, {
              sourceFile: relPath,
              sourceFetchedAt: now,
              contentHash: storeResult.contentHash,
              sourceEtag: storeResult.etag,
              sourceLastModified: storeResult.lastModified,
            });
            sourcesDownloaded++;
          } catch {
            // Best-effort — one failure should not abort the rest
          }
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                citeKey,
                totalCount,
                cached: refs.length,
                sourcesDownloaded,
                citedByFetchedAt: now,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ── get_cited_by ──────────────────────────────────────────────────────────
  const getCitedByShape = {
    citeKey: z
      .string()
      .min(1)
      .describe("Cite key of the case to retrieve cached cited-by data for"),
    format: z.enum(["json", "markdown"]).default("json").optional(),
  };
  const getCitedByParser = z.object(getCitedByShape);

  server.registerTool(
    "get_cited_by",
    {
      title: "Get Cached Cited-By Data",
      description:
        "Return the locally cached cited-by list for a citation. Zero network calls. " +
        "Use cache_cited_by first to populate the data.",
      inputSchema: getCitedByShape,
    },
    async (rawInput) => {
      const { citeKey, format } = getCitedByParser.parse(rawInput);
      const entry = await getCitation(config.cache.dir, citeKey);

      if (!entry) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ found: false, citeKey }),
            },
          ],
        };
      }

      if (!entry.citedBy || entry.citedBy.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                found: true,
                citeKey,
                citedByFetchedAt: entry.citedByFetchedAt ?? null,
                totalCount: entry.citedByTotalCount ?? 0,
                citedBy: [],
                note: "No cited-by data cached. Run cache_cited_by to populate.",
              }),
            },
          ],
        };
      }

      const fmt = format ?? "json";
      if (fmt === "markdown") {
        const header = `**${entry.citedBy.length} of ${entry.citedByTotalCount ?? "?"} citing cases** (fetched ${entry.citedByFetchedAt ?? "unknown"})`;
        const lines = entry.citedBy.map((r) => {
          const source = r.sourceFile ? ` — source: \`${r.sourceFile}\`` : "";
          return `- ${r.aglc4Full ?? r.title}${source}`;
        });
        return { content: [{ type: "text" as const, text: [header, "", ...lines].join("\n") }] };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                found: true,
                citeKey,
                citedByFetchedAt: entry.citedByFetchedAt,
                totalCount: entry.citedByTotalCount,
                citedBy: entry.citedBy,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  return server;
}

async function main() {
  if (process.env.MCP_TRANSPORT === "http") {
    const port = parseInt(process.env.PORT ?? "3000", 10);
    createServer(async (req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }
      // Per-request server + transport (required for stateless streamable HTTP).
      // The SDK's StreamableHTTPServerTransport mutates the Response object and
      // cannot be reused across requests when sessionIdGenerator is undefined.
      const mcpServer = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      res.on("close", () => {
        // Fire-and-forget cleanup; errors here are non-fatal.
        void transport.close().catch(() => {});
        void mcpServer.close().catch(() => {});
      });
      try {
        await mcpServer.connect(transport);
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const bodyStr = Buffer.concat(chunks).toString();
        const body = bodyStr ? (JSON.parse(bodyStr) as Record<string, unknown>) : undefined;
        await transport.handleRequest(req, res, body);
      } catch (err) {
        console.error("auslaw-mcp request error:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: err instanceof Error ? err.message : "Internal server error",
            }),
          );
        }
      }
    }).listen(port, () => {
      console.error(`auslaw-mcp HTTP transport listening on :${port}`);
    });
  } else {
    const server = createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

main().catch((error) => {
  console.error("Fatal server error", error);
  process.exit(1);
});
