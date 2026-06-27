import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const AUSTLII_SEARCH_HTML = readFileSync(
  join(__dirname, "austlii-search-response.html"),
  "utf-8",
);

export const AUSTLII_JUDGMENT_HTML = readFileSync(
  join(__dirname, "austlii-judgment.html"),
  "utf-8",
);

export const AUSTLII_CLOUDFLARE_CHALLENGE_HTML = readFileSync(
  join(__dirname, "austlii-cloudflare-challenge.html"),
  "utf-8",
);

export const AUSTLII_CLASSIC_JUDGMENT_HTML = readFileSync(
  join(__dirname, "austlii-classic-judgment.html"),
  "utf-8",
);

export const OALC_FIXTURE_JSONL_PATH = join(__dirname, "oalc-fixture.jsonl");
