# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- ESLint and Prettier for code quality enforcement
- SECURITY.md for responsible vulnerability disclosure
- CONTRIBUTING.md with development guidelines
- CHANGELOG.md for tracking changes
- Comprehensive project improvement documentation
- Linting and formatting scripts in package.json
- Test coverage support configuration

### Changed
- Updated dependencies to address security vulnerabilities
- Enhanced documentation structure

### Security
- Fixed 3 HIGH severity vulnerabilities in dependencies
- Added npm audit to development workflow

## [0.1.0] - 2024-12-XX

### Added
- Initial MVP release
- AustLII search integration for Australian and NZ legal research
- Intelligent search relevance with auto-detection
- Case law search with jurisdiction filtering
- Legislation search capabilities
- Smart query detection (case names vs topic searches)
- Automatic sort mode selection (relevance vs date)
- Title matching boost for case name queries
- Full-text document retrieval (HTML and PDF)
- OCR support for scanned PDFs using Tesseract
- removed.invalid URL support for document fetching
- Citation extraction (neutral and reported formats)
- Paragraph number preservation for pinpoint citations
- Multiple output formats (JSON, text, markdown, HTML)
- Pagination support with offset parameter
- Multiple search methods (title, phrase, boolean, etc.)
- Comprehensive documentation (README, AGENTS, ROADMAP)
- Real-world integration tests (18 test scenarios)
- GitHub Actions CI/CD workflows
- TypeScript strict mode configuration
- MIT License

### Features
- **Search Tools**:
  - `search_cases` - Search Australian and NZ case law
  - `search_legislation` - Search legislation
  - `fetch_document_text` - Retrieve full text with OCR fallback

- **Jurisdictions Supported**:
  - Commonwealth (cth/federal)
  - All Australian states and territories (VIC, NSW, QLD, SA, WA, TAS, NT, ACT)
  - New Zealand (nz)

- **Smart Search**:
  - Auto-detects case name queries vs topic searches
  - Relevance sorting for specific case lookups
  - Date sorting for recent case research
  - Title matching boost for better results

- **Citation Support**:
  - Neutral citations: `[2024] HCA 26`
  - Reported citations: `(2024) 350 ALR 123`
  - Paragraph numbers: `[N]` format preservation

### Technical
- Node.js 18+ required
- TypeScript 5.9+ with strict mode
- Model Context Protocol (MCP) SDK 1.19+
- Vitest for testing
- Cheerio for HTML parsing
- Axios for HTTP requests
- Tesseract OCR for scanned PDFs

### Documentation
- Comprehensive README with usage examples
- AGENTS.md for AI-assisted development
- ROADMAP.md for planned features
- Architecture documentation

### Testing
- 18 integration test scenarios
- Real-world API testing against AustLII
- Coverage of main use cases:
  - Negligence and duty of care
  - Contract disputes
  - Constitutional law
  - Employment law
  - Property and land law

[Unreleased]: https://github.com/russellbrenner/auslaw-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/russellbrenner/auslaw-mcp/releases/tag/v0.1.0
