# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest release | Yes |

## Reporting a Vulnerability

If you discover a security vulnerability in taskrail, please report it responsibly:

1. **Email**: forge@drolosoft.com
2. **Subject**: `[SECURITY] taskrail: <brief description>`

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact

Receipt will be acknowledged within 48 hours, with a timeline for a fix.

**Do not** open a public GitHub issue for security vulnerabilities.

## Security Considerations

- **No network, no files**: taskrail never opens a connection and never reads or writes a file. The plan lives in the plugin's session state and in the plugin store Claude Code keeps for it.
- **No credentials**: nothing to configure, nothing stored but the plan's own words and task ids.
- **Readable source**: the whole mod is three TypeScript files you can read in a few minutes; there is no build step and no dependency.
