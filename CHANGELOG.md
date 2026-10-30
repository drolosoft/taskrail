# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

## [v0.4.0] - 2026-10-30

### Added
- The tiles line of the board and the bar end with a guess of the time left (`7/14 · ~18m left`) once the first task is done: the wall time since the first start divided by the tasks done, owed by every task not done less what it has already run. Never under a minute; nothing before the first task is done, after the last one, or on a plan saved before task times.

### Changed
- A task that has been 🟩 for five minutes leaves the rows of the board and the rows close up, so a long plan does not grow the band by one row per finished task. The header, the stations, the "N of M" and the tiles still count it; a 🚀 task and a 🟩 task from a plan saved before task times stay in sight.

## [v0.3.0] - 2026-10-24

### Added
- The board times each task: how long it has been running while it runs, and how long it took once it is 🟩 or 🚀 (`🔧 T4 · 12m`). Plans saved before this version draw without times.
- A task nothing touches for fifteen minutes (no `set`, no tool call from its subagent) turns 🧟 on its own; a `set` or an agent event takes it out again. A task waiting on a permission never goes stale.
- `set` says in its result when a wave is being run one task at a time: two or more tasks still 🥚 and at most one running, in a wave that has started. The board itself does not change.

## [v0.2.1] - 2026-10-24

### Added
- Skill `running-waves`: the rules that keep a multi-task plan fast (subagents never wait on each other's processes, own port and server per worktree, long commands in the background, only the tests of what changed while iterating, no rebuild without a change, short briefs, independent plans at once, measure before carrying on). Claude loads it when it runs a plan on the board.

### Fixed
- `set` no longer accepts an icon the board cannot count. ✅ (and ✔️, ☑️) now mean 🟩, so a task marked that way counts as merged instead of sitting at 0 of N forever; any other unknown icon is refused, the task keeps the icon it had and the tool result names it with the valid list.

## [v0.2.0] - 2026-10-19

### Added
- The engine's agent events move tasks on their own (`hooks/auto.ts`): a subagent spawned with a task id in its description makes that task 🔧, a permission request from it 🔑 (the previous icon comes back on its next tool call), and the end of its turn 👀, 💥 or 🛑. Merged and shipped tasks are never touched; `set` still has the last word.
- Every hook survives its own failure: one dim line under the mod's name in the transcript, and the turn, the tool call or the band goes on. A refused `/taskrail` says so there too, instead of vanishing in silence.

### Fixed
- The board no longer hides another mod's band above the prompt (envrail's line, say): it keeps what the mods beneath it drew and goes after it, and when none draws it is alone as before.

## [v0.1.2] - 2026-10-04

### Added
- `ARCHITECTURE.md`, and the release, testing and code style sections of `CONTRIBUTING.md`.

### Changed
- The README says what the header counts, how the tiles are coloured, that `note` exists, and that a plan belongs to its session (a restart needs `--resume`).

### Fixed
- A user skill or command named `taskrail` no longer takes the whole mod down: Claude Code refuses the mod's `/taskrail`, and the tools, the mode and the plan now load anyway.
- `/clear` drops the plan by design, and the README and `ARCHITECTURE.md` say so instead of promising that it survives.
- `tsc --noEmit` is clean: `types/index.d.ts` declares the inputs of `plan`, `set` and `show`, which the type layer Claude Code lays does not know.

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
