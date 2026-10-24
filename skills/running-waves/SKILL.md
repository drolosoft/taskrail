---
name: running-waves
description: Use when running a plan with several tasks on the taskrail board - subagents in worktrees, waves, long test or build commands - or when a run feels slow, a subagent is waiting on another, a command hits the Bash timeout, or the same server is rebuilt on every pass. Rules for keeping the waves fast, measured on real runs.
---

# Running the waves fast

The waves exist to save time: tasks with disjoint files run at once. Measured
on a real run, six subagents at once still produced ten-minute stalls, because
they queued behind each other on shared processes, hit the shell timeout and
rebuilt the same server on every pass. These rules are what came out of it.

## Rules

- **Subagents never wait for each other.** Each worktree gets its own port,
  database and test server, and the brief names them.
- **Never wait on someone else's process.** No `pgrep` of a generic name, no
  `sleep` in a loop. Wait on your own process, by PID or by its output file.
- **Anything over a couple of minutes runs in the background on purpose**
  (`run_in_background`) while something else gets done. Nothing is left to
  hit the Bash timeout.
- **While iterating, only the tests of what changed.** The full suite runs
  when the project says so (before a merge, before a release).
- **A test server or binary is not rebuilt when nothing that produces it
  changed.** If the project cannot tell yet, that becomes a task of its own.
- **Repeated screenshots and checks use a script of the project**, not a new
  one written per task and thrown away.
- **Short briefs.** A subagent gets the files, the change and the check, not
  "read the whole plan". A small task is one subagent, or none.
- **Several independent plans run at once** when they share no files; one at
  a time only for the ones that clash.
- **When something is slow for no reason, measure it** (the session history
  or `time`) before carrying on the same way. Half the time of a subagent is
  usually the model, not the commands: shorter briefs help more than faster
  commands.

## On the board

- Several tasks sit in 🔧 at the same time while their subagents work; one
  🔧 at a time means the waves are being run in series.
- A task waiting on another task's process is 🥱, and the key line says what
  it waits for. If that happens, split the shared resource instead of
  waiting.
- `set` is called when each task closes, not when the wave closes: the board
  shows progress as it happens.
