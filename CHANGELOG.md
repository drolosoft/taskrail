# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- `ARCHITECTURE.md`, and the release, testing and code style sections of `CONTRIBUTING.md`.

### Changed
- The README says what the header counts, how the tiles are coloured, that `note` exists, and that a plan belongs to its session (a restart needs `--resume`).

### Fixed
- A user skill or command named `taskrail` no longer takes the whole mod down: Claude Code refuses the mod's `/taskrail`, and the tools, the mode and the plan now load anyway.
- `/clear` drops the plan by design, and the README and `ARCHITECTURE.md` say so instead of promising that it survives.

## [v0.1.1] - 2026-10-04

### Changed
- The GitHub Actions in CI and the release workflow are pinned to commit SHAs, with Dependabot proposing the bumps.

### Fixed
- The command and tool descriptions and the mode hints said the board sits "under" the prompt; it sits above it, as the README and the band say.
- 🚀, 🛑, 👻 and 🧟 now reach the header counts, and a 🛑 task outranks every other state on its wave's station; before, a wave of shipped or stopped tasks showed as pending.
- The project example in the `plan` tool's schema no longer names private projects.

## [v0.1.0] - 2026-10-04

### Added
- The wave board in the band above the prompt: a rail with one station per wave, the tasks under each station with their state icon, the key line and a thirty-tile progress bar.
- `/taskrail off|bar|full|both` to pick what the band shows; the choice is kept across sessions.
- Three tools for Claude: `plan` starts a board, `set` updates task icons and texts, `show` returns the board as text for the chat.
- The plan survives `/clear`, `/resume` and a restart through the plugin store.
