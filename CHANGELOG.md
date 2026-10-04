# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

### Changed

### Fixed

## [v0.1.0] - 2026-10-04

### Added
- The wave board in the band above the prompt: a rail with one station per wave, the tasks under each station with their state icon, the key line and a thirty-tile progress bar.
- `/taskrail off|bar|full|both` to pick what the band shows; the choice is kept across sessions.
- Three tools for Claude: `plan` starts a board, `set` updates task icons and texts, `show` returns the board as text for the chat.
- The plan survives `/clear`, `/resume` and a restart through the plugin store.
