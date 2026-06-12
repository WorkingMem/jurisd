/**
 * Build the vendored, self-contained test fixture modules (design §6.1).
 *
 * Emits two modules under this directory, each four parquet files + a
 * manifest.json whose `files[]` sha256/rows are computed from the written
 * parquet so the manifest always matches what is on disk:
 *
 *   fixture/          graph/deterministic fixture, embedding: null
 *   fixture-embedded/ tiny embedded fixture, fixed 4-dim vectors + known ranking
 *
 * Self-contained: this is a TS port of jurisd-data/fixture-module/build_fixture.py
 * so the jurisd test suite never reads the sibling repo. Run with:
 *
 *   npx tsx src/test/fixtures/modules/build.ts
 *
 * Requires the optional @duckdb/node-api dependency to regenerate the parquet;
 * the generated parquet + manifests are committed so tests run without it.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const ACL_WORK = "work:cth:competition_and_consumer_act_2010";
const ACL_VER = "ver:cth:competition_and_consumer_act_2010:2026-01-01";
const MABO_VER = "ver:hca:mabo_v_queensland_no_2:1992";

interface TableSpec {
  file: string;
  /** SQL building a VALUES-based relation, columns cast to the parquet schema. */
  selectSql: string;
}

/**
 * Each table is expressed as a typed SELECT so DuckDB writes the exact parquet
 * column types the loader queries against. Strings are single-quote-escaped in
 * the literals below (no user input here — fixed fixture data).
 */
function tableSpecs(embedded: boolean): TableSpec[] {
  const documents: TableSpec = {
    file: "documents.parquet",
    selectSql: `
      SELECT * FROM (VALUES
        ('${ACL_VER}', '${ACL_WORK}', 'primary_legislation', 'commonwealth',
         'federal_register_of_legislation', 'Competition and Consumer Act 2010 (Cth)',
         'https://www.legislation.gov.au/C2004A00109', '2026-01-01'),
        ('${MABO_VER}', NULL, 'decision', 'commonwealth', 'hca',
         'Mabo v Queensland (No 2) [1992] HCA 23',
         'https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1992/23.html', '1992-06-03')
      ) AS t(version_id, work_id, type, jurisdiction, source, citation, url, date)`,
  };

  // 4-dim toy vectors for the embedded fixture; s18 ~ "misleading conduct",
  // sch2 ~ "consumer law", mabo ~ "native title". The known query vector
  // [1,0,0,0] ranks s18 first.
  const embVals = embedded
    ? {
        s18: "[0.98, 0.10, 0.10, 0.10]::FLOAT[]",
        sch2: "[0.30, 0.94, 0.10, 0.10]::FLOAT[]",
        mabo: "[0.10, 0.10, 0.98, 0.10]::FLOAT[]",
      }
    : null;

  const chunks: TableSpec = {
    file: "chunks.parquet",
    selectSql: `
      SELECT version_id, segment_type, provision_ref, char_start, char_end, text, chunk_id ${
        embedded ? ", embedding" : ", CAST(NULL AS FLOAT[]) AS embedding"
      }
      FROM (VALUES
        ('chunk:acl:s18', '${ACL_VER}', 'section', 's 18', 10240, 10512,
         'A person must not, in trade or commerce, engage in conduct that is misleading or deceptive or is likely to mislead or deceive.'${
           embVals ? `, ${embVals.s18}` : ""
         }),
        ('chunk:acl:sch2', '${ACL_VER}', 'schedule', 'sch 2', 0, 240,
         'Schedule 2 -- The Australian Consumer Law. This Schedule may be cited as the Australian Consumer Law.'${
           embVals ? `, ${embVals.sch2}` : ""
         }),
        ('chunk:mabo:para58-60', '${MABO_VER}', 'para_range', '[58]-[60]', 88210, 89020,
         'The common law of Australia recognises a form of native title that reflects the entitlement of the indigenous inhabitants, in accordance with their laws or customs, to their traditional lands.'${
           embVals ? `, ${embVals.mabo}` : ""
         })
      ) AS t(chunk_id, version_id, segment_type, provision_ref, char_start, char_end, text${
        embedded ? ", embedding" : ""
      })`,
  };

  const edges: TableSpec = {
    file: "edges.parquet",
    selectSql: `
      SELECT * FROM (VALUES
        ('edge:mabo->acl:s18', '${MABO_VER}', '${ACL_WORK}', '${ACL_VER}', 'cites',
         's 18 of the Australian Consumer Law', 's 18', 89120, 89156, CAST(NULL AS VARCHAR)),
        ('edge:acl->s18', '${ACL_VER}', '${ACL_WORK}', '${ACL_VER}', 'act_provision',
         'section 18', 's 18', 10240, 10250, CAST(NULL AS VARCHAR))
      ) AS t(edge_id, src, dst_work_id, dst_version_id, kind, mention_text, pinpoint, char_start, char_end, treatment)`,
  };

  const unmatched: TableSpec = {
    file: "unmatched_citations.parquet",
    selectSql: `
      SELECT * FROM (VALUES
        ('Wik Peoples v Queensland (1996) 187 CLR 1', 90400, 90438, 'no_match')
      ) AS t(raw_citation, char_start, char_end, failure_state)`,
  };

  return [documents, chunks, edges, unmatched];
}

function sha256(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

async function buildModule(
  duckdb: typeof import("@duckdb/node-api"),
  opts: { dir: string; name: string; embedded: boolean; snapshotDate: string },
): Promise<void> {
  fs.mkdirSync(opts.dir, { recursive: true });
  const instance = await duckdb.DuckDBInstance.create(":memory:");
  const conn = await instance.connect();

  const filesMeta: { path: string; sha256: string; rows: number }[] = [];
  for (const spec of tableSpecs(opts.embedded)) {
    const out = path.join(opts.dir, spec.file);
    await conn.run(
      `COPY (${spec.selectSql}) TO '${out.replace(/'/g, "''")}' (FORMAT PARQUET, COMPRESSION SNAPPY)`,
    );
    const countRes = await conn.run(`SELECT count(*) AS n FROM (${spec.selectSql})`);
    const rows = Number((await countRes.getRowObjectsJS())[0]!.n);
    filesMeta.push({ path: spec.file, sha256: sha256(out), rows });
  }

  const docCount = filesMeta.find((f) => f.path === "documents.parquet")!.rows;
  const chunkCount = filesMeta.find((f) => f.path === "chunks.parquet")!.rows;

  const manifest = {
    name: opts.name,
    module_version: "0.0.1",
    schema_version: 1,
    yanked: false,
    base_uri: "https://github.com/russellbrenner/jurisd-data/raw/main/fixture-module/",
    snapshot: {
      corpus_sha: "0000000000000000000000000000000000000000",
      date: opts.snapshotDate,
      recipe_repo: "russellbrenner/jurisd-data",
      recipe_git_sha: "fixture-handwritten",
      args: { note: "vendored test fixture, not pipeline-built" },
    },
    coverage: {
      jurisdictions: ["commonwealth"],
      types: ["primary_legislation", "decision"],
      doc_count: docCount,
      chunk_count: chunkCount,
    },
    embedding: opts.embedded ? { model_id: "fixture-toy-4d", dim: 4, normalised: true } : null,
    files: filesMeta,
    licence: {
      spdx: "CC-BY-4.0",
      per_source: [
        {
          source: "federal_register_of_legislation",
          licence: "CC-BY-4.0",
          redistributable: true,
          evidence_url: "https://www.legislation.gov.au/content/copyright",
        },
        {
          source: "hca",
          licence: "CC-BY-4.0",
          redistributable: true,
          evidence_url: "https://www.hcourt.gov.au/registry/copyright",
        },
      ],
      attribution: [
        "Contains material from the Open Australian Legal Corpus (Isaacus), CC BY 4.0.",
        "Federal Register of Legislation material (C) Commonwealth of Australia, CC BY 4.0.",
        "High Court of Australia judgment material, CC BY 4.0.",
      ],
    },
  };

  fs.writeFileSync(
    path.join(opts.dir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf-8",
  );
  console.warn(`wrote ${opts.dir} (${docCount} docs, ${chunkCount} chunks)`);
}

async function main(): Promise<void> {
  const duckdb = await import("@duckdb/node-api");
  // The graph fixture carries a recent snapshot; tests that need a stale one
  // construct it from the embedded fixture's older date below.
  await buildModule(duckdb, {
    dir: path.join(HERE, "fixture"),
    name: "fixture",
    embedded: false,
    snapshotDate: "2026-06-12",
  });
  await buildModule(duckdb, {
    dir: path.join(HERE, "fixture-embedded"),
    name: "fixture-embedded",
    embedded: true,
    snapshotDate: "2020-01-01",
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
