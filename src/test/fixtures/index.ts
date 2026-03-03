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

export const SOURCE_ARTICLE_HTML = readFileSync(
  join(__dirname, "source-article-response.html"),
  "utf-8",
);

export const PROPOSE_CITABLES_MABO = readFileSync(
  join(__dirname, "propose-citables-mabo.txt"),
  "utf-8",
);

export const PROPOSE_CITABLES_RICE = readFileSync(
  join(__dirname, "propose-citables-rice.txt"),
  "utf-8",
);
