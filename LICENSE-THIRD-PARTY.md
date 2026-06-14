# Third-Party Licenses

This project depends on open-source packages. All production and development
dependencies use permissive licenses compatible with this project's MIT license.

## License Summary

| License       | Count |
| ------------- | ----- |
| MIT           | 273   |
| ISC           | 23    |
| BSD-2-Clause  | 17    |
| Apache-2.0    | 14    |
| BSD-3-Clause  | 10    |
| BlueOak-1.0.0 | 3     |
| Python-2.0    | 1     |

## Key Production Dependencies

| Package                   | License | Repository                                             |
| ------------------------- | ------- | ------------------------------------------------------ |
| @modelcontextprotocol/sdk | MIT     | https://github.com/modelcontextprotocol/typescript-sdk |
| axios                     | MIT     | https://github.com/axios/axios                         |
| cheerio                   | MIT     | https://github.com/cheeriojs/cheerio                   |
| file-type                 | MIT     | https://github.com/sindresorhus/file-type              |
| pdf-parse                 | MIT     | https://gitlab.com/nicolumaolo/pdf-parse               |
| tmp                       | MIT     | https://github.com/raszi/node-tmp                      |
| zod                       | MIT     | https://github.com/colinhacks/zod                      |

## Verification

To verify dependency licenses yourself:

```bash
npx license-checker --summary          # Summary view
npx license-checker --production --csv  # Full production list
```

Last verified: 2026-02-11
