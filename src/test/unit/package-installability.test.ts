import * as fs from "node:fs";
import { describe, expect, it } from "vitest";

interface PackageJson {
  main?: string;
  bin?: Record<string, string>;
  files?: string[];
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface PackageLockRoot {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface PackageLock {
  packages: {
    "": PackageLockRoot;
  };
}

const packageJson = JSON.parse(
  fs.readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
) as PackageJson;

const packageLock = JSON.parse(
  fs.readFileSync(new URL("../../../package-lock.json", import.meta.url), "utf8"),
) as PackageLock;

const dockerfile = fs.readFileSync(new URL("../../../Dockerfile", import.meta.url), "utf8");
const gitignore = fs.readFileSync(new URL("../../../.gitignore", import.meta.url), "utf8");
const mainWorkflow = fs.readFileSync(
  new URL("../../../.github/workflows/main.yml", import.meta.url),
  "utf8",
);

describe("package installability metadata", () => {
  it("points the CLI bin at the tracked built entrypoint", () => {
    expect(packageJson.main).toBe("dist/index.js");
    expect(packageJson.bin?.jurisd).toBe("dist/index.js");
    expect(packageJson.files).toContain("dist");
    expect(packageJson.scripts).not.toHaveProperty("prepare");
    expect(gitignore.split(/\r?\n/)).not.toContain("dist");
  });

  it("keeps native recall stacks out of mandatory install metadata", () => {
    expect(packageJson.dependencies).not.toHaveProperty("@duckdb/node-api");
    expect(packageJson.dependencies).not.toHaveProperty("@huggingface/transformers");
    expect(packageJson.optionalDependencies).toHaveProperty("@duckdb/node-api");
    expect(packageJson.optionalDependencies).not.toHaveProperty("@huggingface/transformers");

    const rootLock = packageLock.packages[""];
    expect(rootLock.dependencies).not.toHaveProperty("@duckdb/node-api");
    expect(rootLock.dependencies).not.toHaveProperty("@huggingface/transformers");
    expect(rootLock.optionalDependencies).toHaveProperty("@duckdb/node-api");
    expect(rootLock.optionalDependencies).not.toHaveProperty("@huggingface/transformers");
  });

  it("adds optional native runtime packages explicitly in the container", () => {
    expect(dockerfile).toContain("RUN npm ci --omit=dev --omit=optional");
    expect(dockerfile).toContain("@duckdb/node-api@1.5.3-r.3");
    expect(dockerfile).toContain("impit@0.14.1");
  });

  it("checks that committed dist artifacts match the source build", () => {
    expect(packageJson.scripts?.["check:dist"]).toBe(
      'npm run clean && npm run build && git diff --exit-code -- dist && test -z "$(git status --porcelain -- dist)"',
    );
    expect(mainWorkflow).toContain("npm run check:dist");
  });
});
