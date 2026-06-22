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
const releaseWorkflow = fs.readFileSync(
  new URL("../../../.github/workflows/release.yml", import.meta.url),
  "utf8",
);

function releaseWorkflowJob(name: string): string {
  const match = releaseWorkflow.match(
    new RegExp(`\\n  ${name}:\\n[\\s\\S]*?(?=\\n  [a-zA-Z0-9_-]+:\\n|$)`),
  );
  expect(match).not.toBeNull();
  return match?.[0] ?? "";
}

describe("package installability metadata", () => {
  it("points the CLI bin at the tracked built entrypoint", () => {
    expect(packageJson.main).toBe("dist/index.js");
    expect(packageJson.bin?.jurisd).toBe("dist/index.js");
    expect(packageJson.files).toContain("dist");
    expect(packageJson.scripts).not.toHaveProperty("prepare");
    expect(gitignore.split(/\r?\n/)).not.toContain("dist");
  });

  it("keeps native recall stacks optional while installing the AustLII transport by default", () => {
    expect(packageJson.dependencies).not.toHaveProperty("@duckdb/node-api");
    expect(packageJson.dependencies).not.toHaveProperty("@huggingface/transformers");
    expect(packageJson.dependencies).toHaveProperty("impit", "0.14.1");
    expect(packageJson.optionalDependencies).toHaveProperty("@duckdb/node-api");
    expect(packageJson.optionalDependencies).not.toHaveProperty("@huggingface/transformers");
    expect(packageJson.optionalDependencies).not.toHaveProperty("impit");

    const rootLock = packageLock.packages[""];
    expect(rootLock.dependencies).not.toHaveProperty("@duckdb/node-api");
    expect(rootLock.dependencies).not.toHaveProperty("@huggingface/transformers");
    expect(rootLock.dependencies).toHaveProperty("impit", "0.14.1");
    expect(rootLock.optionalDependencies).toHaveProperty("@duckdb/node-api");
    expect(rootLock.optionalDependencies).not.toHaveProperty("@huggingface/transformers");
    expect(rootLock.optionalDependencies).not.toHaveProperty("impit");
  });

  it("keeps optional native production dependencies in the container", () => {
    expect(dockerfile).toContain("RUN npm ci --omit=dev");
    expect(dockerfile).not.toContain("--omit=optional");
    expect(dockerfile).toContain("optional native packages declared by");
    expect(dockerfile).toContain("@duckdb/node-api is also included");
    expect(dockerfile).toContain("impit itself is a normal production");
  });

  it("checks that committed dist artifacts match the source build", () => {
    expect(packageJson.scripts?.["check:dist"]).toBe(
      'npm run clean && npm run build && git diff --exit-code -- dist && test -z "$(git status --porcelain -- dist)"',
    );
    expect(mainWorkflow).toContain("npm run check:dist");
  });

  it("publishes release tags through npm trusted publishing", () => {
    const verifyJob = releaseWorkflowJob("verify");
    const publishJob = releaseWorkflowJob("publish");
    const githubReleaseJob = releaseWorkflowJob("github-release");

    expect(releaseWorkflow).toContain("permissions:\n  contents: read");
    expect(verifyJob).toContain("permissions:\n      contents: read");
    expect(verifyJob).not.toContain("id-token: write");
    expect(verifyJob).toContain("persist-credentials: false");
    expect(verifyJob).toContain('test "$TAG_VERSION" = "$PACKAGE_VERSION"');
    expect(verifyJob).toContain("npm run check:dist");
    expect(verifyJob).toContain("npm pack --json");
    expect(verifyJob).toContain("actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a");

    expect(publishJob).toContain("needs: verify");
    expect(publishJob).toContain("environment: npm-publish");
    expect(publishJob).toContain("id-token: write");
    expect(releaseWorkflow).toContain('node-version: "24.x"');
    expect(releaseWorkflow).toContain("package-manager-cache: false");
    expect(publishJob).toContain('registry-url: "https://registry.npmjs.org"');
    expect(publishJob).toContain(
      "actions/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131",
    );
    expect(publishJob).toContain("npm publish *.tgz --access public");
    expect(publishJob).not.toContain("npm ci");
    expect(publishJob).not.toContain("npm test");

    expect(githubReleaseJob).toContain("needs: publish");
    expect(githubReleaseJob).toContain("contents: write");
  });
});
