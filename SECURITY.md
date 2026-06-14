# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

**Please do not open public issues for security vulnerabilities.**

To report a security vulnerability, please email: contact@workingmem.ai

We will respond within 48 hours and provide updates as the issue is addressed.

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Security Considerations

This tool:

- Makes HTTP requests to AustLII and jade.io
- Does not store user data
- Does not require authentication
- Runs locally as an MCP server
- Extracts digital text from PDFs via pdf-parse (no OCR)

### For Users

- Keep dependencies updated (`npm audit fix`)
- Review source code before running
- Use in trusted environments only
- Be aware of rate limiting when querying public APIs

### For Contributors

- Run `npm audit` before submitting PRs
- Follow secure coding practices
- Report vulnerabilities privately
- Test security-related changes thoroughly

## Known Security Considerations

### Dependency Vulnerabilities

We monitor dependencies for vulnerabilities using:

- `npm audit`
- Dependabot alerts
- Regular dependency updates

### External API Calls

This tool makes requests to:

- AustLII (public legal database)
- jade.io (if user provides URLs)

Users should:

- Respect terms of service of these platforms
- Implement rate limiting in production use
- Not expose this tool to untrusted input sources

## Security Updates

Security updates are released as soon as possible after a vulnerability is confirmed. Users should:

- Subscribe to GitHub releases
- Monitor npm advisories
- Update promptly when security releases are published

## Contact

For security-related questions: contact@workingmem.ai

For general questions: Open a GitHub issue
