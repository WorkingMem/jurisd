# Release process

This repository publishes npm releases from the tag-triggered GitHub Actions
workflow at `.github/workflows/release.yml`.

## 0.4.0 npm publishing setup

Before tagging `v0.4.0`, an npm package owner must authorise this repository as
the trusted publisher for the `jurisd` package:

```bash
npm trust github jurisd --repo russellbrenner/jurisd --file release.yml --allow-publish
```

The trusted publisher must match:

- package: `jurisd`
- repository: `russellbrenner/jurisd`
- workflow filename: `release.yml`
- allowed action: `npm publish`

The release workflow uses GitHub OIDC, so it does not need an `NPM_TOKEN` secret.
The workflow runs on GitHub-hosted Ubuntu, grants `id-token: write`, uses Node
24, disables package-manager caching for the release build, validates the
package tarball with `npm pack --dry-run`, publishes with `npm publish --access
public`, then creates the GitHub release.

## Tagging a release

1. Confirm `package.json`, `package-lock.json`, and `CHANGELOG.md` contain the
   release version.
2. Confirm the trusted publisher is configured on npm.
3. Create and push the tag:

   ```bash
   git tag v0.4.0
   git push origin v0.4.0
   ```

4. Confirm the release workflow completed.
5. Confirm the package is visible:

   ```bash
   npm view jurisd@0.4.0 version
   ```

If trusted publishing is not configured, `npm publish` must fail rather than
falling back to a long-lived token.
