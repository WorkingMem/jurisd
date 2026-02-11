# Contributing to AusLaw MCP

Thank you for considering contributing to AusLaw MCP! This document provides guidelines for contributing to this project.

## Code of Conduct

Please be respectful and constructive in all interactions. We are committed to providing a welcoming and inclusive environment for all contributors.

## Getting Started

### Prerequisites

- Node.js 18.x or higher
- npm or yarn package manager
- Git
- (Optional) Tesseract OCR for testing PDF functionality

### Setting Up Development Environment

1. **Fork the repository**
   ```bash
   # Click "Fork" on GitHub, then clone your fork
   git clone https://github.com/YOUR_USERNAME/auslaw-mcp.git
   cd auslaw-mcp
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the project**
   ```bash
   npm run build
   ```

4. **Run tests**
   ```bash
   npm test
   ```

5. **Start development mode**
   ```bash
   npm run dev
   ```

## Development Workflow

### Creating a Branch

Create a descriptive branch name:
```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/issue-description
```

### Making Changes

1. **Write code following the style guide**
   - Use TypeScript strict mode
   - Follow existing code patterns
   - Add JSDoc comments for exported functions

2. **Run linting and formatting**
   ```bash
   npm run lint:fix
   npm run format
   ```

3. **Add tests for new features**
   - Place tests in appropriate directories
   - Follow existing test patterns
   - Ensure tests pass: `npm test`

4. **Build and verify**
   ```bash
   npm run build
   ```

### Commit Messages

Use clear, descriptive commit messages:
```
feat: Add pagination support to search results
fix: Correct citation parsing for reported cases
docs: Update README with new examples
test: Add unit tests for citation extraction
```

Prefix types:
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `test:` Adding or updating tests
- `refactor:` Code refactoring
- `style:` Code style changes (formatting, etc.)
- `chore:` Maintenance tasks

## Development Guidelines

### Code Style

**For detailed guidance, see [AGENTS.md](AGENTS.md).**

Key principles:
- **TypeScript strict mode**: All code must type-check
- **No `any` types**: Use proper types or `unknown`
- **Error handling**: Wrap network calls in try/catch
- **Primary sources only**: Never return journal articles
- **Preserve citations**: Keep paragraph numbers `[N]` intact

### Testing Requirements

Every PR must include:
- ✅ TypeScript compilation passes (`npm run build`)
- ✅ All tests pass (`npm test`)
- ✅ Linting passes (`npm run lint`)
- ✅ Formatting is correct (`npm run format:check`)
- ✅ New tests for new features
- ✅ Tests validate real behavior (not just mocks)

### Documentation

Update documentation when:
- Adding new features
- Changing public APIs
- Modifying configuration options
- Adding new dependencies

Files to update:
- `README.md` - User-facing documentation
- `AGENTS.md` - AI agent development guidelines
- `ROADMAP.md` - Feature planning (if major changes)
- JSDoc comments - All exported functions

## Pull Request Process

### Before Submitting

1. **Update your branch**
   ```bash
   git fetch origin
   git rebase origin/main
   ```

2. **Run all checks**
   ```bash
   npm run lint
   npm run format:check
   npm run build
   npm test
   ```

3. **Review your changes**
   ```bash
   git diff origin/main
   ```

### Submitting a PR

1. **Push your branch**
   ```bash
   git push origin feature/your-feature-name
   ```

2. **Create Pull Request on GitHub**
   - Use a clear, descriptive title
   - Reference any related issues
   - Describe what changes were made and why
   - Include examples if adding features

3. **PR Template Checklist**
   - [ ] Tests added/updated
   - [ ] Documentation updated
   - [ ] Code follows style guidelines
   - [ ] All CI checks pass
   - [ ] No breaking changes (or documented if necessary)

### Review Process

- Maintainers will review your PR
- Address feedback in new commits
- Once approved, maintainers will merge

## Types of Contributions

### Bug Reports

**Before submitting:**
- Search existing issues
- Check if it's already fixed in `main`

**Include:**
- Clear description
- Steps to reproduce
- Expected vs actual behavior
- Environment (Node version, OS, etc.)
- Relevant logs or error messages

### Feature Requests

**Before submitting:**
- Check ROADMAP.md for planned features
- Search existing issues/discussions

**Include:**
- Clear use case
- Proposed solution
- Why it benefits the project
- Alternatives considered

### Code Contributions

**Good first issues:**
- Look for `good first issue` label
- Start with documentation improvements
- Add tests for existing code
- Fix minor bugs

**Major features:**
- Discuss in an issue first
- Follow the ROADMAP.md priorities
- Break into smaller PRs when possible

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode for development
npm run test:watch
```

### Writing Tests

Place tests in appropriate locations:
- `src/test/unit/` - Unit tests for individual functions
- `src/test/integration/` - Integration tests with live APIs

Example test:
```typescript
import { describe, it, expect } from 'vitest';
import { searchAustLii } from '../../services/austlii';

describe('searchAustLii', () => {
  it('should return search results', async () => {
    const results = await searchAustLii('negligence', {
      type: 'case',
      limit: 5
    });
    
    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
  });
});
```

## Project Structure

```
src/
├── index.ts              # MCP server entry point
├── services/
│   ├── austlii.ts       # AustLII search integration
│   └── fetcher.ts       # Document text retrieval
├── utils/
│   └── formatter.ts     # Output formatting
└── test/
    ├── unit/            # Unit tests
    └── integration/     # Integration tests
```

## Resources

- **Project Documentation**: [README.md](README.md)
- **AI Agent Guidelines**: [AGENTS.md](AGENTS.md)
- **Development Roadmap**: [docs/ROADMAP.md](docs/ROADMAP.md)
- **AustLII Search Help**: https://www.austlii.edu.au/austlii/help/search.html
- **MCP Specification**: https://modelcontextprotocol.io/

## Getting Help

- **Questions**: Open a GitHub Discussion
- **Bugs**: Open a GitHub Issue
- **Security**: Email russell@lawquarter.com
- **General**: Comment on relevant issues

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Remember**: This is a legal research tool. Accuracy and authority of sources are paramount. When in doubt, prioritize returning the most authoritative version of a judgment over returning more results.
