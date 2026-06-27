# Worked research session

An end-to-end transcript showing how the `jurisd-research` skill drives a real
research task. The goal: **find and verify the authority for native title in
Australia, pinpoint the key paragraph, cache it, and emit an AGLC4 bibliography.**

User prompts are in quotes; tool calls show the arguments that matter; results are
abbreviated.

---

**User:** "Find the High Court decision that established native title in Australia,
verify it, pinpoint where the Court recognised native title survives, and add it to
my bibliography for the document `essay-native-title`."

### 1. Orient — what can I answer offline?

```
list_data_modules { }
→ { count: 1, modules: [
    { name: "legislation-cth", version: "0.3.1", coverage: { jurisdiction: ["cth"],
      type: ["primary_legislation"] }, status: "ready", snapshot: "2026-05-30" } ] }
```

A Commonwealth **legislation** module is installed, but no **case-law** module. So
for this case-law task I lead with the **live** tools; I would have led with
`get_provision` / `find_citing` if a decisions module covered HCA.

### 2. Find authority

Open-ended topic, so `search_cases` rather than `resolve_citation`:

```
search_cases { query: "native title recognition", jurisdiction: "cth",
               method: "auto", limit: 5 }
→ [ { title: "Mabo v Queensland (No 2)", neutralCitation: "[1992] HCA 23",
      reportedCitation: "(1992) 175 CLR 1", url: "https://.../HCA/1992/23.html",
      source: "austlii" }, ... ]
```

### 3. Verify the citation

I have a neutral citation now, so I switch to `resolve_citation` to confirm it
resolves to a canonical AustLII URL:

```
resolve_citation { citation: "[1992] HCA 23", mode: "validate" }
→ { valid: true, austliiUrl: "https://www.austlii.edu.au/.../HCA/1992/23.html" }
```

### 4. Pinpoint the key paragraph

`format_citation mode=pinpoint` fetches the judgment and locates the paragraph by
phrase (use `paragraphNumber` if I already know it):

```
format_citation {
  mode: "pinpoint",
  url: "https://www.austlii.edu.au/.../HCA/1992/23.html",
  phrase: "native title survives",
  caseCitation: "Mabo v Queensland (No 2) [1992] HCA 23"
}
→ { paragraphNumber: 64, pinpointString: "[64]",
    fullCitation: "Mabo v Queensland (No 2) [1992] HCA 23 [64]" }
```

### 5. Cache the source and mint a cite key

`cite action=add` records the source, assigns a biblatex cite key, and returns the
canonical AGLC4 string. I scope it to the `essay-native-title` document:

```
cite {
  action: "add",
  title: "Mabo v Queensland (No 2)",
  neutralCitation: "[1992] HCA 23",
  reportedCitation: "(1992) 175 CLR 1",
  url: "https://www.austlii.edu.au/.../HCA/1992/23.html",
  type: "case", court: "HCA", year: 1992, pinpoint: "[64]",
  document: "essay-native-title"
}
→ { citeKey: "mabo1992", aglc4Full:
    "Mabo v Queensland (No 2) [1992] HCA 23 (1992) 175 CLR 1 [64]", cached: true }
```

### 6. (Optional) who relies on it

When a decisions module covers the area, I trace later citing cases offline:

```
find_citing { target: "Mabo v Queensland (No 2) [1992] HCA 23" }
→ { target: "mabo1992", count: 27, citations: [ ... ] }
```

### 7. Emit the bibliography

```
bibliography { op: "export", document: "essay-native-title" }
→ { path: ".../essay-native-title.bib", entries: 1,
    bib: "@jurisdiction{mabo1992, ... }" }
```

---

## Second-reference citations later in the document

When citing Mabo again in the same document, use the short-form modes with the
**abbreviated** title chosen at first reference (`Mabo`), not the full case name:

```
format_citation { mode: "short", title: "Mabo", pinpointPara: 64 }   → Mabo [64]
format_citation { mode: "ibid", title: "Mabo", pinpointPara: 70 }    → Ibid [70]
format_citation { mode: "subsequent", title: "Mabo", footnoteRef: 1 } → Mabo (n 1)
```

## When a legislation module is installed

The same task for a **provision** (e.g. "what does s 18 of the Australian Consumer
Law say?") would lead with the offline path and never touch the network:

```
get_provision { act: "Competition and Consumer Act 2010 (Cth)", provision: "sch 2 s 18" }
→ { found: true, text: "A person must not, in trade or commerce, engage in conduct
    that is misleading or deceptive...", metadata: { source: "local_module",
    module: "legislation-cth", version: "0.3.1", snapshot: "2026-05-30" } }
```

On a typed not-found, fall through to `search_legislation` →
`fetch_document_text`.
