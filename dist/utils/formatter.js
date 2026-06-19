import * as cheerio from "cheerio";
import { formatAGLC4 } from "../services/citation.js";
const ALLOWED_HTML_TAGS = new Set([
    "a",
    "article",
    "blockquote",
    "br",
    "caption",
    "code",
    "dd",
    "div",
    "dl",
    "dt",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "li",
    "ol",
    "p",
    "pre",
    "section",
    "span",
    "strong",
    "sub",
    "sup",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "tr",
    "u",
    "ul",
]);
const REMOVED_HTML_TAGS = new Set([
    "audio",
    "button",
    "canvas",
    "embed",
    "form",
    "iframe",
    "input",
    "link",
    "math",
    "meta",
    "object",
    "script",
    "select",
    "source",
    "style",
    "svg",
    "textarea",
    "video",
]);
const GLOBAL_HTML_ATTRS = new Set(["class", "title"]);
const TAG_HTML_ATTRS = {
    a: new Set(["href", "name"]),
    td: new Set(["colspan", "rowspan"]),
    th: new Set(["colspan", "rowspan", "scope"]),
};
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
function stripAnsiAndOsc(input) {
    let output = "";
    for (let i = 0; i < input.length; i += 1) {
        const code = input.charCodeAt(i);
        if (code !== 0x1b) {
            output += input[i];
            continue;
        }
        const next = input[i + 1];
        if (next === "]") {
            i += 2;
            while (i < input.length) {
                const current = input.charCodeAt(i);
                if (current === 0x07) {
                    break;
                }
                if (current === 0x1b && input[i + 1] === "\\") {
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }
        if (next === "[") {
            i += 2;
            while (i < input.length) {
                const current = input.charCodeAt(i);
                if (current >= 0x40 && current <= 0x7e) {
                    break;
                }
                i += 1;
            }
        }
    }
    return output;
}
function isUnsafeInlineCodePoint(codePoint) {
    return ((codePoint >= 0x00 && codePoint <= 0x08) ||
        codePoint === 0x0b ||
        codePoint === 0x0c ||
        (codePoint >= 0x0e && codePoint <= 0x1f) ||
        (codePoint >= 0x7f && codePoint <= 0x9f) ||
        codePoint === 0x061c ||
        codePoint === 0x200e ||
        codePoint === 0x200f ||
        (codePoint >= 0x202a && codePoint <= 0x202e) ||
        (codePoint >= 0x2066 && codePoint <= 0x2069));
}
function stripUnsafeInlineControls(input) {
    return Array.from(input)
        .filter((char) => {
        const codePoint = char.codePointAt(0);
        return codePoint === undefined || !isUnsafeInlineCodePoint(codePoint);
    })
        .join("");
}
function terminalSafeInline(input) {
    return stripUnsafeInlineControls(stripAnsiAndOsc(input))
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
}
function terminalSafeBlock(input) {
    return stripUnsafeInlineControls(stripAnsiAndOsc(input)).replace(/\r\n?/g, "\n");
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
function isAllowedHtmlAttr(tagName, attrName) {
    return GLOBAL_HTML_ATTRS.has(attrName) || (TAG_HTML_ATTRS[tagName]?.has(attrName) ?? false);
}
function sanitiseHtmlFragment(input) {
    const $ = cheerio.load(input, null, false);
    $("*").each((_, element) => {
        const node = $(element);
        const tagName = String(node.prop("tagName") ?? "").toLowerCase();
        if (REMOVED_HTML_TAGS.has(tagName)) {
            node.remove();
            return;
        }
        if (!ALLOWED_HTML_TAGS.has(tagName)) {
            node.replaceWith(node.contents());
            return;
        }
        for (const [attrName, attrValue] of Object.entries(node.attr() ?? {})) {
            const name = attrName.toLowerCase();
            if (!isAllowedHtmlAttr(tagName, name)) {
                node.removeAttr(attrName);
                continue;
            }
            if (name === "href") {
                const safeUrl = safeLinkUrl(attrValue);
                if (safeUrl) {
                    node.attr(attrName, safeUrl);
                }
                else {
                    node.removeAttr(attrName);
                }
            }
        }
    });
    return $.root().html() ?? "";
}
export function formatSearchResults(results, format, options = {}) {
    const enriched = withAglc4(results);
    const warnings = options.warnings?.filter((warning) => warning.message) ?? [];
    const sources = options.sources;
    const sourceSummary = sourceStatusSummary(sources);
    const degraded = warnings.length > 0 ||
        (sources ? Object.values(sources).some((status) => status !== "ok") : false);
    const degradedData = degraded
        ? { results: enriched, warnings, ...(sources ? { sources } : {}), degraded: true }
        : undefined;
    switch (format) {
        case "json": {
            const data = degradedData ?? enriched;
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
                ...(degradedData ? { structuredContent: { format: "html", data: degradedData } } : {}),
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
                ...(degradedData ? { structuredContent: { format: "markdown", data: degradedData } } : {}),
            };
        }
        case "text":
        default: {
            const warningLines = warnings.map((warning) => `Warning: ${warning.message}`);
            const sourceLines = sourceSummary ? [sourceSummary] : [];
            const lines = enriched.map((result, idx) => {
                const summary = result.summary ? `\n  ${terminalSafeInline(result.summary)}` : "";
                return `${idx + 1}. ${terminalSafeInline(result.aglc4)}\n   ${terminalSafeInline(result.url)}${summary}`;
            });
            return {
                content: ensureContent([...warningLines, ...sourceLines, ...lines].join("\n")),
                ...(degradedData ? { structuredContent: { format: "text", data: degradedData } } : {}),
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
            if (response.html) {
                return {
                    content: ensureContent(wrapInStyledDocument(sanitiseHtmlFragment(response.html), response.sourceUrl)),
                };
            }
            return {
                content: ensureContent(wrapInStyledDocument(`<article data-source="${escapeHtml(terminalSafeInline(response.sourceUrl))}"><pre>${escapeHtml(terminalSafeBlock(response.text))}</pre></article>`, terminalSafeInline(response.sourceUrl))),
            };
        case "markdown":
            return {
                content: ensureContent(`> Source: ${markdownInline(response.sourceUrl)}\n\n\`\`\`text\n${markdownFence(response.text)}\n\`\`\``),
            };
        case "text":
        default:
            return {
                content: ensureContent(terminalSafeBlock(response.text)),
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