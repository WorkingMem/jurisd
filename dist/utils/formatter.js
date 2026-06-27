import { formatAGLC4 } from "../services/citation.js";
const MARKDOWN_INLINE_CHARS = new Set([
    "<",
    ">",
    "]",
    "[",
    "`",
    "*",
    "_",
    "{",
    "}",
    "(",
    ")",
    "#",
    "+",
    ".",
    "!",
    "|",
    "-",
]);
function ensureContent(text) {
    return text
        ? [
            {
                type: "text",
                text,
            },
        ]
        : [{ type: "text", text: "" }];
}
/**
 * Formats an array of search results into the requested output format.
 *
 * @param results - Search results to format
 * @param format - Desired output format (json, text, markdown, or html)
 * @returns An MCP {@link CallToolResult} containing the formatted content
 */
/** Attach a canonical AGLC4 string to each search result. */
function withAglc4(results) {
    return results.map((r) => ({
        ...r,
        aglc4: formatAGLC4({
            title: r.title,
            neutralCitation: r.neutralCitation,
            reportedCitation: r.reportedCitation,
        }),
    }));
}
function sourceStatusSummary(sources) {
    if (!sources)
        return undefined;
    const nonOk = Object.entries(sources).filter(([, status]) => status !== "ok");
    if (nonOk.length === 0)
        return undefined;
    return `Source status: ${nonOk.map(([source, status]) => `${source}=${status}`).join(", ")}`;
}
function safeLinkUrl(input) {
    if (!input)
        return undefined;
    if (input.startsWith("#") && /^#[A-Za-z0-9_.:-]*$/.test(input))
        return input;
    try {
        const parsed = new URL(input);
        return parsed.protocol === "http:" || parsed.protocol === "https:"
            ? parsed.toString()
            : undefined;
    }
    catch {
        return undefined;
    }
}
function markdownInline(input) {
    return input
        .replace(/\\/g, "\\\\")
        .replace(/./gs, (char) => (MARKDOWN_INLINE_CHARS.has(char) ? `\\${char}` : char))
        .replace(/\s+/g, " ");
}
function markdownCode(input) {
    return input.replace(/`/g, "\\`").replace(/\s+/g, " ");
}
function markdownFence(input) {
    return input.replace(/```/g, "`\\`\\`");
}
function markdownLink(label, url) {
    const safeUrl = safeLinkUrl(url);
    const safeLabel = markdownInline(label);
    return safeUrl ? `[${safeLabel}](${safeUrl})` : safeLabel;
}
export function formatSearchResults(results, format, options = {}) {
    const enriched = withAglc4(results);
    const warnings = options.warnings?.filter((warning) => warning.message) ?? [];
    const sources = options.sources;
    const sourceSummary = sourceStatusSummary(sources);
    // `degraded` means the search came up short and the caller must act — it is
    // driven by warnings, which a caller only raises when nothing recovered the
    // results. A blocked primary source that a fallback substituted for is NOT
    // degraded: it is reported through `sources` as provenance, not as failure.
    const degraded = warnings.length > 0;
    // Emit the structured meta object whenever there is anything to report
    // (warnings or source provenance); otherwise the payload stays a bare array.
    const hasMeta = warnings.length > 0 || sources !== undefined;
    const metaData = hasMeta
        ? {
            results: enriched,
            ...(warnings.length > 0 ? { warnings } : {}),
            ...(sources ? { sources } : {}),
            ...(degraded ? { degraded: true } : {}),
        }
        : undefined;
    switch (format) {
        case "json": {
            const data = metaData ?? enriched;
            return {
                content: ensureContent(JSON.stringify(data, null, 2)),
                structuredContent: {
                    format: "json",
                    data,
                },
            };
        }
        case "html": {
            const warningHtml = warnings
                .map((warning) => `<p class="warning">${escapeHtml(warning.message)}</p>`)
                .join("\n");
            const sourceHtml = sourceSummary
                ? `<p class="source-status">${escapeHtml(sourceSummary)}</p>`
                : "";
            const rows = enriched
                .map((result) => {
                const citation = result.citation ?? result.neutralCitation ?? "";
                const reported = result.reportedCitation && result.reportedCitation !== citation
                    ? ` <span class="reported-citation">${escapeHtml(result.reportedCitation)}</span>`
                    : "";
                const summary = result.summary ? `<p>${escapeHtml(result.summary)}</p>` : "";
                const aglc4 = result.aglc4
                    ? ` <span class="aglc4">${escapeHtml(result.aglc4)}</span>`
                    : "";
                const safeUrl = safeLinkUrl(result.url);
                const href = safeUrl ? ` href="${escapeHtml(safeUrl)}"` : "";
                return `<li><a${href}>${escapeHtml(result.title)}</a>${citation ? ` (${escapeHtml(citation)})` : ""}${reported}${aglc4}${summary}</li>`;
            })
                .join("\n");
            return {
                content: ensureContent(`${warningHtml ? `${warningHtml}\n` : ""}${sourceHtml ? `${sourceHtml}\n` : ""}<ul>\n${rows}\n</ul>`),
                ...(metaData ? { structuredContent: { format: "html", data: metaData } } : {}),
            };
        }
        case "markdown": {
            const warningLines = warnings.map((warning) => `> ${markdownInline(warning.message)}`);
            const sourceLines = sourceSummary ? [`> ${markdownInline(sourceSummary)}`] : [];
            const lines = enriched.map((result) => {
                const summary = result.summary ? ` - ${markdownInline(result.summary)}` : "";
                return `- ${markdownLink(result.title, result.url)} (\`${markdownCode(result.aglc4)}\`)${summary}`;
            });
            return {
                content: ensureContent([...warningLines, ...sourceLines, ...lines].join("\n")),
                ...(metaData ? { structuredContent: { format: "markdown", data: metaData } } : {}),
            };
        }
        case "text":
        default: {
            const warningLines = warnings.map((warning) => `Warning: ${warning.message}`);
            const sourceLines = sourceSummary ? [sourceSummary] : [];
            const lines = enriched.map((result, idx) => {
                const summary = result.summary ? `\n  ${result.summary}` : "";
                return `${idx + 1}. ${result.aglc4}\n   ${result.url}${summary}`;
            });
            return {
                content: ensureContent([...warningLines, ...sourceLines, ...lines].join("\n")),
                ...(metaData ? { structuredContent: { format: "text", data: metaData } } : {}),
            };
        }
    }
}
/**
 * Formats a fetched document response into the requested output format.
 *
 * @param response - The fetch response containing the document text
 * @param format - Desired output format (json, text, markdown, or html)
 * @returns An MCP {@link CallToolResult} containing the formatted content
 */
export function formatFetchResponse(response, format) {
    switch (format) {
        case "json": {
            // Omit the bulky html field from JSON output; consumers should
            // request format=html when they need the styled document.
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { html: _html, ...jsonSafe } = response;
            return {
                content: ensureContent(JSON.stringify(jsonSafe, null, 2)),
                structuredContent: {
                    format: "json",
                    data: jsonSafe,
                },
            };
        }
        case "html":
            return {
                content: ensureContent(wrapInStyledDocument(`<article data-source="${escapeHtml(response.sourceUrl)}"><pre>${escapeHtml(response.text)}</pre></article>`, response.sourceUrl)),
            };
        case "markdown":
            return {
                content: ensureContent(`> Source: ${markdownInline(response.sourceUrl)}\n\n\`\`\`text\n${markdownFence(response.text)}\n\`\`\``),
            };
        case "text":
        default:
            return {
                content: ensureContent(response.text),
            };
    }
}
function wrapInStyledDocument(bodyHtml, sourceUrl) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="source" content="${escapeHtml(sourceUrl)}">
<style>
  body {
    font-family: "Georgia", "Times New Roman", serif;
    font-size: 14px;
    line-height: 1.6;
    max-width: 800px;
    margin: 2em auto;
    padding: 0 1.5em;
    color: #222;
  }
  h1, h2, h3 { font-family: "Helvetica Neue", Arial, sans-serif; }
  h1 { font-size: 1.5em; border-bottom: 1px solid #ccc; padding-bottom: 0.3em; }
  h2 { font-size: 1.2em; margin-top: 1.5em; }
  p { margin: 0.8em 0; text-align: justify; }
  a { color: #1a5276; }
  @media print {
    body { margin: 0; padding: 0; max-width: none; font-size: 12px; }
  }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}
function escapeHtml(input) {
    return input
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
//# sourceMappingURL=formatter.js.map