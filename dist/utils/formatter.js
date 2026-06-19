import { formatAGLC4 } from "../services/citation.js";
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
const MARKDOWN_SPECIALS = new RegExp("([\\\\`*_{}\\[\\]()#+\\-.!|<>])", "g");
const MARKDOWN_CODE_SPECIALS = new RegExp("([\\\\`\\[\\]()])", "g");
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
function escapeMarkdown(input) {
    return terminalSafeInline(input).replace(MARKDOWN_SPECIALS, "\\$1");
}
function escapeMarkdownCode(input) {
    return terminalSafeInline(input).replace(MARKDOWN_CODE_SPECIALS, "\\$1");
}
function markdownUrl(input) {
    return terminalSafeInline(input).replace(/\)/g, "%29").replace(/\s/g, "%20");
}
function markdownCodeFence(input) {
    const safe = terminalSafeBlock(input);
    const longestBacktickRun = Math.max(0, ...Array.from(safe.matchAll(/`+/g), (match) => match[0].length));
    const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
    return `${fence}text\n${safe}\n${fence}`;
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
export function formatSearchResults(results, format) {
    const enriched = withAglc4(results);
    switch (format) {
        case "json":
            return {
                content: ensureContent(JSON.stringify(enriched, null, 2)),
                structuredContent: {
                    format: "json",
                    data: enriched,
                },
            };
        case "html": {
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
                return `<li><a href="${escapeHtml(result.url)}">${escapeHtml(result.title)}</a>${citation ? ` (${escapeHtml(citation)})` : ""}${reported}${aglc4}${summary}</li>`;
            })
                .join("\n");
            return {
                content: ensureContent(`<ul>\n${rows}\n</ul>`),
            };
        }
        case "markdown": {
            const lines = enriched.map((result) => {
                const summary = result.summary ? ` - ${escapeMarkdown(result.summary)}` : "";
                return `- [${escapeMarkdown(result.title)}](${markdownUrl(result.url)}) (\`${escapeMarkdownCode(result.aglc4)}\`)${summary}`;
            });
            return {
                content: ensureContent(lines.join("\n")),
            };
        }
        case "text":
        default: {
            const lines = enriched.map((result, idx) => {
                const summary = result.summary ? `\n  ${terminalSafeInline(result.summary)}` : "";
                return `${idx + 1}. ${terminalSafeInline(result.aglc4)}\n   ${terminalSafeInline(result.url)}${summary}`;
            });
            return {
                content: ensureContent(lines.join("\n")),
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
                content: ensureContent(wrapInStyledDocument(`<article data-source="${escapeHtml(terminalSafeInline(response.sourceUrl))}"><pre>${escapeHtml(terminalSafeBlock(response.text))}</pre></article>`, terminalSafeInline(response.sourceUrl))),
            };
        case "markdown":
            return {
                content: ensureContent(`> Source: ${markdownUrl(response.sourceUrl)}\n\n${markdownCodeFence(response.text)}`),
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