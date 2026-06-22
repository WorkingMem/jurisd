import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import path from "node:path";
import {
  formatFetchResponse,
  formatSearchResults,
  type SearchSourceStatuses,
  type SearchWarning,
} from "./utils/formatter.js";
import { fetchDocumentText } from "./services/fetcher.js";
import { searchAustLii, type SearchResult, type SearchOptions } from "./services/austlii.js";
import { searchAustliiViaExaWithStatus } from "./services/exa.js";
import { mergeCaseSearchResults } from "./services/search-merge.js";
import {
  resolveArticle,
  buildCitationLookupUrl,
  searchUpstreamWithStatus,
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
import {
  getProvision,
  getActStructure,
  listDataModules,
  findCiting,
  semanticSearchLocal,
} from "./services/modules.js";
import { getActiveAdapter } from "./services/capabilities.js";
import { config } from "./config.js";
import { CloudflareBlockedError } from "./errors.js";

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

function jurisdictionFromAustliiPath(url: string): string | undefined {
  try {
    const pathParts = new URL(url).pathname.split("/");
    const casesIndex = pathParts.indexOf("cases");
    return casesIndex >= 0 ? pathParts[casesIndex + 1]?.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

function requestedJurisdiction(options: SearchOptions): string | undefined {
  if (!options.jurisdiction || options.jurisdiction === "other") {
    return undefined;
  }
  return options.jurisdiction === "federal" ? "cth" : options.jurisdiction;
}

function directAustliiResultFromNeutralQuery(
  query: string,
  options: SearchOptions,
): SearchResult | undefined {
  if (options.type !== "case") {
    return undefined;
  }
  const neutralCitation = normaliseCitation(query).match(NEUTRAL_CITATION_PATTERN)?.[0];
  if (!neutralCitation) {
    return undefined;
  }
  const url = austliiUrlFromNeutral(neutralCitation);
  if (!url) {
    return undefined;
  }
  const jurisdiction = jurisdictionFromAustliiPath(url);
  const requested = requestedJurisdiction(options);
  if (requested && jurisdiction !== requested) {
    return undefined;
  }
  const year = neutralCitation.match(/\[(\d{4})\]/)?.[1];
  return {
    title: neutralCitation,
    neutralCitation,
    url,
    source: "austlii",
    discoverySource: "citation-url",
    jurisdiction,
    year,
    type: "case",
  };
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

function austliiSearchWarning(error: unknown): SearchWarning | undefined {
  if (!(error instanceof CloudflareBlockedError)) return undefined;
  return {
    code: "austlii_cloudflare_blocked",
    source: "austlii",
    message:
      "AustLII search is blocked by a Cloudflare challenge. Configure EXA_API_KEY " +
      "(Exa search discovery) or SESSION_COOKIE (removed.invalid) to recover results; " +
      "direct document fetch still works when you already have a URL.",
  };
}

/**
 * Build a fresh McpServer with all tools registered.
 *
 * Tool surface follows the tool-surface consolidation: 10 base tools, with
 * mode/op/action dispatch replacing the former one-tool-per-operation layout.
 *
 * In stateless HTTP mode (`sessionIdGenerator: undefined`), each request
 * requires its own server + transport instance because
 * `StreamableHTTPServerTransport` tracks per-request state on the Response
 * object. Reusing a single server/transport across requests throws
 * "Transport is already started" or silently corrupts the state machine.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "jurisd",
    version: "0.1.0",
    description: "Australian legislation and case law searcher with document retrieval.",
  });

  // ── search_legislation ────────────────────────────────────────────────────
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
      const options: SearchOptions = {
        type: "legislation",
        jurisdiction,
        limit,
        sortBy,
        method,
        offset,
      };

      try {
        const results = await searchAustLii(query, options);
        return formatSearchResults(results, format ?? "json");
      } catch (error) {
        const warning = austliiSearchWarning(error);
        if (!warning) throw error;
        const exaOutcome = await searchAustliiViaExaWithStatus(
          query,
          options,
          limit ?? config.defaults.searchLimit,
        );
        if (exaOutcome.results.length > 0) {
          return formatSearchResults(exaOutcome.results, format ?? "json", {
            sources: { austlii: "blocked", exa: exaOutcome.status },
          });
        }
        return formatSearchResults([], format ?? "json", {
          warnings: [warning],
          sources: { austlii: "blocked", exa: exaOutcome.status },
        });
      }
    },
  );

  // ── search_cases ──────────────────────────────────────────────────────────
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

      const caseOptions: SearchOptions = {
        type: "case",
        jurisdiction,
        limit,
        sortBy,
        method,
        offset,
      };

      const warnings: SearchWarning[] = [];
      const sources: SearchSourceStatuses = {};

      // Run AustLII and removed.invalid searches independently so a blocked AustLII
      // search cannot discard useful removed.invalid case results.
      const [austliiOutcome, sourceOutcome] = await Promise.allSettled([
        searchAustLii(query, caseOptions),
        searchUpstreamWithStatus(query, { type: "case", jurisdiction, limit }),
      ]);

      let austliiResults: SearchResult[] = [];
      if (austliiOutcome.status === "fulfilled") {
        austliiResults = austliiOutcome.value;
        sources.austlii = "ok";
      } else {
        const warning = austliiSearchWarning(austliiOutcome.reason);
        if (!warning) throw austliiOutcome.reason;
        warnings.push(warning);
        sources.austlii = "blocked";
      }

      if (sourceOutcome.status === "rejected") throw sourceOutcome.reason;

      const upstreamResults = sourceOutcome.value.results;
      sources.source = sourceOutcome.value.status;
      let merged = mergeCaseSearchResults(austliiResults, upstreamResults, limit);

      // Deterministic citation URLs and Exa search discovery avoid failing the
      // whole search when AustLII's own search endpoint is Cloudflare-blocked.
      if (merged.length === 0 && sources.austlii === "blocked") {
        const directResult = directAustliiResultFromNeutralQuery(query, caseOptions);
        if (directResult) {
          merged = [directResult];
          sources.austlii_direct = "ok";
        } else {
          const exaOutcome = await searchAustliiViaExaWithStatus(
            query,
            caseOptions,
            limit ?? config.defaults.searchLimit,
          );
          sources.exa = exaOutcome.status;
          if (exaOutcome.results.length > 0) {
            merged = exaOutcome.results.slice(0, limit ?? config.defaults.searchLimit);
          }
        }
      }

      const includeSourceStatus =
        warnings.length > 0 || Object.values(sources).some((status) => status !== "ok");

      return formatSearchResults(
        merged,
        format ?? "json",
        includeSourceStatus ? { warnings, sources } : undefined,
      );
    },
  );

  // ── fetch_document_text ───────────────────────────────────────────────────
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
        "Fetch full text for a legislation or case URL (AustLII or removed.invalid). When a `citeKey` is supplied and AUSLAW_FETCH_SOURCES is not set to 'false', also saves a local markdown copy to the sources directory and updates the cache entry's HTTP freshness headers. Without `citeKey`, only the document text is returned.",
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

  // ── source_lookup ───────────────────────────────────────────────────────────
  const sourceLookupShape = {
    by: z
      .enum(["article_id", "citation"])
      .describe(
        "Lookup key: article_id resolves metadata for a numeric removed.invalid article ID; citation builds a removed.invalid lookup URL for a neutral citation",
      ),
    articleId: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("removed.invalid article ID — required when by=article_id"),
    citation: z
      .string()
      .min(1)
      .optional()
      .describe("Neutral citation, e.g. '[2008] NSWSC 323' — required when by=citation"),
  };
  const sourceLookupParser = z.object(sourceLookupShape).superRefine((d, ctx) => {
    if (d.by === "article_id" && d.articleId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "articleId is required when by=article_id",
      });
    }
    if (d.by === "citation" && !d.citation) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "citation is required when by=citation",
      });
    }
  });

  server.registerTool(
    "source_lookup",
    {
      title: "Look up removed.invalid Article or Citation",
      description:
        "Look up removed.invalid (Upstream Source) by article ID or neutral citation. by=article_id resolves metadata (case name, neutral citation, jurisdiction, year) for a numeric article ID. by=citation generates a removed.invalid lookup URL for a neutral citation (e.g. '[2008] NSWSC 323') — removed.invalid does not expose a public search API, so this provides a direct link.",
      inputSchema: sourceLookupShape,
    },
    async (rawInput) => {
      const input = sourceLookupParser.parse(rawInput);

      if (input.by === "article_id") {
        const article = await resolveArticle(input.articleId!);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(article, null, 2),
            },
          ],
        };
      }

      const lookupUrl = buildCitationLookupUrl(input.citation!);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ citation: input.citation, sourceUrl: lookupUrl }, null, 2),
          },
        ],
      };
    },
  );

  // ── format_citation ───────────────────────────────────────────────────────
  const formatCitationShape = {
    mode: z
      .enum(["full", "short", "ibid", "subsequent", "pinpoint"])
      .default("full")
      .describe(
        "full = AGLC4 full citation (default); short = short form; ibid = Ibid (back-to-back same source); subsequent = title (n X); pinpoint = fetch a judgment and generate a paragraph pinpoint",
      ),
    title: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Case name, e.g. 'Mabo v Queensland (No 2)' (full mode) or the abbreviated case name chosen at first reference, e.g. 'Mabo' (short/ibid/subsequent). Required for all modes except pinpoint.",
      ),
    neutralCitation: z
      .string()
      .optional()
      .describe("Neutral citation, e.g. '[1992] HCA 23' (full mode)"),
    reportedCitation: z
      .string()
      .optional()
      .describe("Reported citation, e.g. '(1992) 175 CLR 1' (full mode)"),
    pinpoint: z.string().optional().describe("Pinpoint reference, e.g. '[20]' (full mode)"),
    style: z
      .enum(["neutral", "reported", "combined"])
      .default("combined")
      .describe(
        "Citation style for full mode: neutral (neutral only), reported (reported only), combined (both)",
      ),
    footnoteRef: z
      .number()
      .int()
      .optional()
      .describe("Footnote number of first citation — required for subsequent mode"),
    pinpointPara: z
      .number()
      .int()
      .optional()
      .describe("Paragraph pinpoint number for short-form modes, e.g. 20 → [20]"),
    pinpointPage: z
      .number()
      .int()
      .optional()
      .describe("Page pinpoint number for short-form modes, e.g. 401"),
    url: z
      .string()
      .url()
      .optional()
      .describe("AustLII document URL to fetch and search — required for pinpoint mode"),
    paragraphNumber: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Paragraph number to locate (pinpoint mode)"),
    phrase: z
      .string()
      .min(1)
      .optional()
      .describe("Phrase to search for within paragraphs (pinpoint mode)"),
    caseCitation: z
      .string()
      .optional()
      .describe(
        "Case citation to prepend to the pinpoint, e.g. '[2022] FedCFamC2F 786' (pinpoint mode)",
      ),
  };
  const formatCitationParser = z.object(formatCitationShape).superRefine((d, ctx) => {
    if (d.mode === "pinpoint") {
      if (!d.url) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "url is required for pinpoint mode",
        });
      }
      if (d.paragraphNumber === undefined && d.phrase === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Provide at least one of paragraphNumber or phrase for pinpoint mode",
        });
      }
    } else if (!d.title) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `title is required for ${d.mode} mode`,
      });
    }
    if (d.mode === "subsequent" && d.footnoteRef === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "footnoteRef is required for subsequent mode",
      });
    }
  });

  server.registerTool(
    "format_citation",
    {
      title: "Format AGLC4 Citation",
      description:
        "Format an Australian case citation per AGLC4 rules. mode=full combines case name, neutral citation, reported citation, and optional pinpoint. mode=short/ibid/subsequent produce AGLC4 short-form, Ibid, and subsequent references (subsequent requires footnoteRef). mode=pinpoint fetches a judgment from AustLII and generates a pinpoint citation to a specific paragraph (by number or phrase).",
      inputSchema: formatCitationShape,
    },
    async (rawInput) => {
      const input = formatCitationParser.parse(rawInput);

      if (input.mode === "pinpoint") {
        const doc = await fetchDocumentText(input.url!);
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
        const pinpoint = generatePinpoint(doc.paragraphs, {
          paragraphNumber: input.paragraphNumber,
          phrase: input.phrase,
        });
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
        const fullCitation = input.caseCitation
          ? `${input.caseCitation} ${pinpoint.pinpointString}`
          : pinpoint.pinpointString;
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ ...pinpoint, fullCitation }, null, 2),
            },
          ],
        };
      }

      if (input.mode === "short" || input.mode === "ibid" || input.mode === "subsequent") {
        const pinpoint =
          input.pinpointPara !== undefined
            ? { type: "para" as const, n: input.pinpointPara }
            : input.pinpointPage !== undefined
              ? { type: "page" as const, n: input.pinpointPage }
              : undefined;

        const result = formatShortForm({
          title: input.title!,
          mode: input.mode,
          footnoteRef: input.footnoteRef,
          pinpoint,
        });
        return { content: [{ type: "text" as const, text: result }] };
      }

      // mode === "full"
      const info = {
        title: input.title!,
        neutralCitation: input.style !== "reported" ? input.neutralCitation : undefined,
        reportedCitation: input.style !== "neutral" ? input.reportedCitation : undefined,
        pinpoint: input.pinpoint,
      };
      const formatted = formatAGLC4(info);
      return { content: [{ type: "text" as const, text: formatted }] };
    },
  );

  // ── resolve_citation ──────────────────────────────────────────────────────
  const resolveCitationShape = {
    citation: z
      .string()
      .min(1)
      .describe("Citation or case name, e.g. '[1992] HCA 23' or 'Mabo v Queensland'"),
    mode: z
      .enum(["auto", "validate", "search"])
      .default("auto")
      .describe(
        "auto = validate neutral citations against AustLII then fall back to text search; validate = AustLII existence check only; search = text search only",
      ),
    format: formatEnum.optional(),
  };
  const resolveCitationParser = z.object(resolveCitationShape);

  server.registerTool(
    "resolve_citation",
    {
      title: "Resolve Citation",
      description:
        "Resolve a citation to its authoritative source. mode=auto (default) validates a detected neutral citation against AustLII and returns the direct URL, falling back to a case name search otherwise. mode=validate checks that a neutral citation exists on AustLII and returns the canonical URL. mode=search performs a text search only.",
      inputSchema: resolveCitationShape,
    },
    async (rawInput) => {
      const { citation, mode, format } = resolveCitationParser.parse(rawInput);

      if (mode === "validate") {
        const result = await validateCitation(citation);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      }

      if (mode === "auto") {
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
      }

      // mode === "search", or auto fallback to text search
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

  // ── cite ──────────────────────────────────────────────────────────────────
  const citeShape = {
    action: z
      .enum(["add", "refresh_source"])
      .default("add")
      .describe(
        "add = store/update a citation in the local cache (default); refresh_source = check the cached source file's freshness via conditional HEAD and re-download when stale",
      ),
    title: z
      .string()
      .min(1)
      .optional()
      .describe("Case name, e.g. 'Mabo v Queensland (No 2)' — required for action=add"),
    neutralCitation: z.string().optional().describe("Neutral citation, e.g. '[1992] HCA 23'"),
    reportedCitation: z.string().optional().describe("Reported citation, e.g. '(1992) 175 CLR 1'"),
    url: z
      .string()
      .url()
      .optional()
      .describe("Primary source URL (AustLII or removed.invalid) — required for action=add"),
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
    citeKey: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Cite key of a cached citation, e.g. 'mabo1992' — required for action=refresh_source",
      ),
  };
  const citeParser = z.object(citeShape).superRefine((d, ctx) => {
    if (d.action === "add") {
      if (!d.title) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "title is required for action=add",
        });
      }
      if (!d.url) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "url is required for action=add",
        });
      }
    }
    if (d.action === "refresh_source" && !d.citeKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "citeKey is required for action=refresh_source",
      });
    }
  });

  server.registerTool(
    "cite",
    {
      title: "Cite (Cache Citation / Refresh Source)",
      description:
        "Write to the local citation cache. action=add (default) stores or updates a citation, assigns a biblatex-compatible cite key on first use, and returns the cite key and canonical AGLC4 string. action=refresh_source checks whether the locally cached source file for a citation is still current (conditional HEAD using stored ETag/Last-Modified) and re-downloads it when the remote is newer.",
      inputSchema: citeShape,
    },
    async (rawInput) => {
      const input = citeParser.parse(rawInput);

      if (input.action === "refresh_source") {
        const citeKey = input.citeKey!;
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
      }

      // action === "add"
      const aglc4Full = formatAGLC4({
        title: input.title!,
        neutralCitation: input.style !== "reported" ? input.neutralCitation : undefined,
        reportedCitation: input.style !== "neutral" ? input.reportedCitation : undefined,
        pinpoint: input.pinpoint,
      });

      const citeKey = await upsertCitation(config.cache.dir, {
        title: input.title!,
        neutralCitation: input.neutralCitation,
        reportedCitation: input.reportedCitation,
        aglc4Full,
        url: input.url!,
        type: input.type,
        jurisdiction: input.jurisdiction,
        year: input.year,
        court: input.court,
        keywords: input.keywords,
        summary: input.summary,
        document: input.document,
        footnoteNumber: input.footnoteNumber,
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

  // ── bibliography ──────────────────────────────────────────────────────────
  const bibliographyShape = {
    op: z
      .enum(["get", "list", "export", "cited_by"])
      .default("list")
      .describe(
        "get = look up one cached citation; list = list cached citations (default); export = write a BibLaTeX .bib file; cited_by = return the cached cited-by list for a citation",
      ),
    query: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Cite key (e.g. 'mabo1992'), AGLC4 citation string, neutral citation, or case title — required for op=get",
      ),
    citeKey: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Cite key of the case to retrieve cached cited-by data for — required for op=cited_by",
      ),
    document: z
      .string()
      .optional()
      .describe(
        "Filter to citations used in this document (op=list/export). Omit for all project citations.",
      ),
    format: formatEnum.optional(),
    outputPath: z
      .string()
      .optional()
      .describe(
        "Write the .bib file to this path (op=export). Relative to the cache dir, or an absolute path that resolves within it; must end in .bib. Defaults to <cacheDir>/<projectName>.bib",
      ),
  };
  const bibliographyParser = z.object(bibliographyShape).superRefine((d, ctx) => {
    if (d.op === "get" && !d.query) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "query is required for op=get",
      });
    }
    if (d.op === "cited_by" && !d.citeKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "citeKey is required for op=cited_by",
      });
    }
  });

  server.registerTool(
    "bibliography",
    {
      title: "Bibliography (Read Citation Cache)",
      description:
        "Read from the local citation cache without network calls. op=get retrieves one citation by cite key, AGLC4 string, neutral citation, or title. op=list (default) lists cached citations, optionally filtered to a document. op=export writes a BibLaTeX .bib file and returns the bib text. op=cited_by returns the locally cached cited-by list for a citation (run cache_cited_by first to populate).",
      inputSchema: bibliographyShape,
    },
    async (rawInput) => {
      const input = bibliographyParser.parse(rawInput);

      if (input.op === "get") {
        const entry = await getCitation(config.cache.dir, input.query!);
        if (!entry) {
          return {
            content: [
              { type: "text" as const, text: JSON.stringify({ found: false, query: input.query }) },
            ],
          };
        }
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ found: true, ...entry }, null, 2) },
          ],
        };
      }

      if (input.op === "export") {
        const bibText = await exportBib(config.cache.dir, input.document);

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
        // Confine the (caller-supplied) outputPath to the cache directory so a
        // malicious/prompt-injected MCP client cannot write bib text to an
        // arbitrary location (e.g. an autostart dir or a config file).
        const cacheRoot = path.resolve(config.cache.dir);
        const writePath = path.resolve(cacheRoot, input.outputPath ?? defaultPath);
        const relToCache = path.relative(cacheRoot, writePath);
        if (relToCache.startsWith("..") || path.isAbsolute(relToCache)) {
          throw new Error("outputPath must resolve within the cache directory");
        }
        if (!writePath.endsWith(".bib")) {
          throw new Error("outputPath must end in .bib");
        }

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
      }

      if (input.op === "cited_by") {
        const citeKey = input.citeKey!;
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

        const fmt = input.format ?? "json";
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
      }

      // op === "list"
      const entries = await listCitations(config.cache.dir, input.document);
      const fmt = input.format ?? "json";

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

  // ── get_provision ─────────────────────────────────────────────────────────
  // Layer-1 deterministic recall over installed data modules.
  const getProvisionShape = {
    act: z
      .string()
      .min(1)
      .describe(
        "Act work identity or citation, e.g. 'Competition and Consumer Act 2010 (Cth)' or a work_id",
      ),
    provision: z
      .string()
      .min(1)
      .describe("Citable provision reference, e.g. 's 18', 'sch 2', 'reg 12', 'cl 4(1)'"),
    module: z
      .string()
      .optional()
      .describe("Pin a specific module by name; otherwise the best-covering ready module is used"),
    format: formatEnum.optional(),
  };
  const getProvisionParser = z.object(getProvisionShape);

  server.registerTool(
    "get_provision",
    {
      title: "Get Provision (local module)",
      description:
        "Deterministic provision lookup over installed local data modules (offline). Resolves a single " +
        "provision of an Act or instrument by its citable handle (no embedding, no ranking). Returns the " +
        "provision text with provenance, or a typed not-found result so the router can fall through to live " +
        "AustLII. Requires @duckdb/node-api and at least one installed module.",
      inputSchema: getProvisionShape,
    },
    async (rawInput) => {
      const { act, provision, module } = getProvisionParser.parse(rawInput);
      const result = await getProvision({ act, provision, module });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // ── get_act_structure ─────────────────────────────────────────────────────
  const getActStructureShape = {
    act: z.string().min(1).describe("Act work identity or citation"),
    depth: z
      .number()
      .int()
      .min(1)
      .max(12)
      .optional()
      .describe("Max tree depth; default 12 (also the cycle backstop)"),
    module: z.string().optional(),
    format: formatEnum.optional(),
  };
  const getActStructureParser = z.object(getActStructureShape);

  server.registerTool(
    "get_act_structure",
    {
      title: "Get Act Structure (local module)",
      description:
        "Return the containment tree of an Act (Act -> Part -> Division -> section/schedule/clause) by " +
        "walking 'act_provision' edges in an installed local data module (offline, closed-world). Returns a " +
        "nested tree or a typed not-found result. Requires @duckdb/node-api and at least one installed module.",
      inputSchema: getActStructureShape,
    },
    async (rawInput) => {
      const { act, depth, module } = getActStructureParser.parse(rawInput);
      const result = await getActStructure({ act, depth, module });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // ── list_data_modules ─────────────────────────────────────────────────────
  const listDataModulesShape = {
    refresh: z.boolean().optional().describe("Re-scan the modules dir before listing"),
    includeInvalid: z
      .boolean()
      .optional()
      .describe("Include refused modules with their status reason"),
    format: formatEnum.optional(),
  };
  const listDataModulesParser = z.object(listDataModulesShape);

  server.registerTool(
    "list_data_modules",
    {
      title: "List Data Modules",
      description:
        "Introspect the installed local data modules: name, version, jurisdiction/type coverage, doc/chunk " +
        "counts, embedding descriptor, load status, snapshot date and staleness. Use includeInvalid to see " +
        "refused modules and why they did not load. Reads metadata only (no DuckDB attach).",
      inputSchema: listDataModulesShape,
    },
    async (rawInput) => {
      const { refresh, includeInvalid } = listDataModulesParser.parse(rawInput);
      const modules = listDataModules({ refresh, includeInvalid });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ count: modules.length, modules }, null, 2),
          },
        ],
      };
    },
  );

  // ── find_citing ───────────────────────────────────────────────────────────
  const findCitingShape = {
    target: z
      .string()
      .min(1)
      .describe(
        "Citation or work/version identity of the cited document, e.g. 'Mabo v Queensland (No 2) [1992] HCA 23'",
      ),
    kinds: z
      .array(z.enum(["cites", "considers"]))
      .optional()
      .describe(
        "Edge kinds to include; default both. 'considers' is the stronger substantive-engagement signal",
      ),
    module: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
    format: formatEnum.optional(),
  };
  const findCitingParser = z.object(findCitingShape);

  server.registerTool(
    "find_citing",
    {
      title: "Find Citing Documents (local module)",
      description:
        "The offline twin of search_citing_cases: documents in installed local data modules whose text cites " +
        "a target document, via cites/considers edges (closed-world, deterministic). Returns each citing " +
        "document with the provenance span of the citation. Use search_citing_cases for the live removed.invalid " +
        "citator instead. Requires @duckdb/node-api and at least one installed module.",
      inputSchema: findCitingShape,
    },
    async (rawInput) => {
      const { target, kinds, module, limit } = findCitingParser.parse(rawInput);
      const result = await findCiting({ target, kinds, module, limit });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // ── semantic_search_local ─────────────────────────────────────────────────
  const semanticSearchLocalShape = {
    query: z.string().min(1).describe("Natural-language query, embedded locally"),
    module: z
      .string()
      .optional()
      .describe(
        "Pin a module; otherwise all embedded ready modules whose embedding model_id+dim match the local embedder",
      ),
    k: z.number().int().min(1).max(50).optional(),
    filter: z
      .object({
        jurisdiction: z.string().optional(),
        type: z
          .enum(["decision", "primary_legislation", "secondary_legislation", "bill"])
          .optional(),
        segment_type: z.string().optional(),
      })
      .optional()
      .describe("Facet pre-filters applied before ranking"),
    format: formatEnum.optional(),
  };
  const semanticSearchLocalParser = z.object(semanticSearchLocalShape);

  server.registerTool(
    "semantic_search_local",
    {
      title: "Semantic Search (local module)",
      description:
        "Vector recall over installed local data modules: the query is embedded locally (bge-small, offline, " +
        "no key) and ranked by cosine similarity over chunk embeddings, with optional jurisdiction/type/" +
        "segment facet pre-filters. Gated on the local embedder being installed and the module being " +
        "embedded with a matching descriptor; degrades visibly (typed notes) when unavailable. Requires " +
        "@duckdb/node-api, @huggingface/transformers, and an embedded module.",
      inputSchema: semanticSearchLocalShape,
    },
    async (rawInput) => {
      const { query, module, k, filter } = semanticSearchLocalParser.parse(rawInput);
      const adapter = await getActiveAdapter();
      const result = await semanticSearchLocal({ query, module, k, filter }, adapter);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  return server;
}
