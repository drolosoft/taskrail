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

## Code style

A JSDoc block above every function, a `//` comment above each constant that
is not obvious, one statement per line, and every string a person or the
model can see in English. `hooks/board.ts` never touches `$`; everything
that talks to the engine lives in `hooks/register.tsx`. See
[ARCHITECTURE.md](ARCHITECTURE.md).

## Testing

Tests live in `tests/taskrail.test.ts` and use the kit from
`claude-code/testing`. Drawing is tested as plain functions
(`renderText(plan, 40)`, `renderBar`); the command, the tools and the band
run through `$` with a mocked clock, store and session id (`mockWorld`).
The band is mounted on both the terminal and the desktop surfaces. CI runs
the same `claude plugin test .`, plus `scripts/changelog-section_test.sh`,
which guards the script that turns a CHANGELOG section into release notes.

The type check is not part of CI and has to stay clean:
`npx -p typescript tsc --noEmit -p tsconfig.json` prints nothing. A new
tool, or a new field of an existing one, goes in `types/index.d.ts` first.

## Releasing

1. Move the `[Unreleased]` lines of `CHANGELOG.md` under
   `## [vX.Y.Z] - YYYY-MM-DD`.
2. Set `version` in `.claude-plugin/plugin.json` to `X.Y.Z`.
3. Commit, push, and wait for the `test` job to go green.
4. Push the tag `vX.Y.Z`. The release workflow refuses it when the tag and
   the manifest disagree, when the CHANGELOG section is empty, or when CI
   was not green on that commit; otherwise it publishes the GitHub release
   with that section as notes.

Two things to keep in mind: installed copies update only when `version`
changes, and the marketplace entry points at `main` with no ref, so
whatever is merged reaches new installs before it is tagged. Keep `main`
releasable.

## What belongs in the repository

This is a public repository: source, tests and user documentation. Planning notes, specs and agent configuration stay out (`docs/superpowers/`, `.claude/` and `CLAUDE.md` are ignored).
