# Contributing to taskrail

Contributions are welcome: bug fixes, better drawing, documentation.

## Getting started

1. Fork the repository
2. Create a branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run `claude plugin validate --strict .` and `claude plugin test .`
5. Commit and open a pull request

## Development setup

```bash
git clone https://github.com/YOUR-USERNAME/taskrail.git
cd taskrail
claude plugin test .          # runs tests/*.test.ts in the mod's own environment
claude --plugin-dir .         # one session with your working copy loaded
```

Requires Claude Code 2.1.287 or later. Saving a file reloads the mod in the session started with `--plugin-dir`. The first load lays `.claude-plugin/types/` and a `tsconfig.json` at the root; both are ignored by git, and `tsc --noEmit -p tsconfig.json` type-checks the mod against them.

## What belongs in the repository

This is a public repository: source, tests and user documentation. Planning notes, specs and agent configuration stay out (`docs/superpowers/`, `.claude/` and `CLAUDE.md` are ignored).
