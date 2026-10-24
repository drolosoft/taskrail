# Architecture

taskrail is a Claude Code mod: a plugin whose `hooks/hooks.json` names one
TypeScript module that the engine loads into the session. Everything the
mod does happens through the `$` object that module receives: session
state, the plugin store, the band above the prompt, a command and three
tools. There is no build step, no dependency and no process of its own.

## How it works

Three source files with one rule between them:

- `hooks/board.ts` holds the plan model and every drawing function
  (`renderFull`, `renderBar`, `renderText`, `headerLine`, `modeHint`,
  `newPlan`, `applyUpdates`). It never touches `$`, so it can be tested as
  plain functions and `claude plugin validate` can still see every engine
  call the mod makes.
- `hooks/auto.ts` holds the rules that turn the engine's agent events into
  task moves (`taskOf`, `onSpawn`, `onPermission`, `onToolStart`,
  `onComplete`), pure like the board: each takes the plan and the links
  between agents and tasks and returns the new ones with a `changed` flag,
  so the hooks module writes nothing when a rule had nothing to say.
- `hooks/register.tsx` is the only file that talks to the engine: it
  registers the `/taskrail` command and the `plan`, `set` and `show`
  tools at `session.start`, keeps the plan, the mode and the links, hooks
  `agent.spawn`, `turn.complete`, `classic.PermissionRequest` and
  `tool.call` for the rules, and draws the band in `ui.render` for the
  `AbovePrompt` component. The band is shared: the hook keeps whatever the
  hooks beneath it drew (another mod's line) and puts the board after it,
  so a short status line stays on top and the board is what scrolls when
  the band runs out of rows.

Every hook that is not the mod's own tool call runs its work inside a
`try` and passes the event on whatever happened: a failure is written once
to the transcript (`noteFailure`, one dim line under the mod's name) and
the spawn, the turn, the tool call or the band go through. The band
computes its drawing before asking the hooks beneath it, so a plan the
renderer cannot draw leaves the band to the other mods instead of taking
it down.

`types/index.d.ts` declares the plan types, the shape of the mod's state
and the inputs of the three tools for the engine's type layer. The tools
are declared by hand (`McpToolInputs`) because the types the engine lays
only list the MCP servers a session had connected, never a mod's own tools.

## Where the state lives

| What | Where | Why |
|---|---|---|
| The plan | session state (`$.state`, reactive) and the plugin store under `plan:<session id>` | the state redraws the band on every change; the store survives `/resume` and a restart followed by `--resume` |
| The mode | the plugin store under `mode`, one value per machine | the choice is a preference, not part of a plan |
| The links (agent id → task, and the icon held during a permission) | session state only | an agent does not outlive its session, so there is nothing to bring back after `/resume`; a new `plan` empties them |

`/clear`, `/resume` and a fork reset the session state and do not fire
`session.start`; the mod listens to `classic.SessionStart` with those
sources. After `/resume` and a fork it loads both values from the store
again; after `/clear` it loads the mode only, because the plan goes with the
conversation it belonged to. A brand-new session has no plan until Claude
calls `plan`: one board per session, by design.

At `session.start` the command is registered inside a `try`: the engine
refuses `/taskrail` when the user already has a skill or a command with that
name, and the refusal must not stop the tools, the mode and the plan from
loading.

## Flows

- `plan` refuses an input without at least one wave; every task starts 🥚.
- `set` refuses to run before a plan exists; task ids the plan does not
  know are ignored and listed in the result, so one typo never drops the
  whole update.
- Every tool result ends with the mode hint (`modeHint`), the line that
  tells Claude what the current mode asks of the chat, so Claude never has
  to read a settings file.
- `show` returns `renderText` at the default width, for the chat.
- A task in a running state (🔧 👀 🩹 🧪) whose last touch is more than
  `STALE_AFTER_MS` (fifteen minutes) old turns 🧟, its key line kept
  (`staleTasks`, `markStale`). The once-a-minute timer, `set` and `show`
  write it; the band, which may not write while it draws, draws the plan
  with its stale tasks already marked.
- The event rules (`hooks/auto.ts`) find a task by its id as a whole word
  in the spawn's description, then its name, longest id first (`T12`
  before `T1`, `rev` never inside `review`). A spawn makes the task 🔧
  only from 🥚 🥱 👻 🧟, but ties the agent either way, so a reviewer's
  permission or end still reaches the task. A permission holds the task at
  🔑 from a running state (🔧 👀 🩹 🧪) and keeps the icon it had; the
  agent's next tool call gives it back unless the model moved the task
  meanwhile; with nothing held, a call renews the task's touch, at most
  once a minute, so a task does not go stale while its agent works. The
  end of a turn moves 🔧, 🔑 or 🧟 to 👀 on an answer, and
  anything not 🟩 or 🚀 to 💥 on an error or a refusal, 🛑 on an
  interruption. The main loop's own events carry no agent id and change
  nothing.

## Drawing

- Emoji count as two terminal cells, but only those in the `EMOJI` set;
  box glyphs, Latin and digits count one. A new icon goes in that set first.
- The header counts the icons listed in `ORDER`; a wave's station shows
  the first icon of `URGENCY` found among its tasks, or 🟩 when every task
  is merged, or 🥚; the tiles are green for 🟩, yellow for the `RUNNING`
  icons (at least one tile while anything runs) and red for the rest.
- Each task carries its times (`TaskTimes`: last write, first start, done),
  stamped by `applyUpdates`, so `set` and the event rules record them the
  same way. The drawing takes the time as a parameter (`now`) and stays
  pure; a column is ten cells, or wider when a task's time needs it, and
  its station on the rail widens with it. A once-a-minute timer started at
  `session.start` checks for stale tasks and redraws the band so the
  minutes move between writes.
- The rules stretch to the band's width less two cells, never under 40.
  Rows may run longer than the rules; the band truncates them.
- The board has no right border because rows carry different numbers of
  emoji and a right edge would zigzag.
- The band draws nothing while the engine shows a survey, and nothing in
  mode `off`.

## Known limitations

- Store keys `plan:<session id>` are never deleted.
- `set` accepts any string as an icon; one outside `ORDER` is drawn and
  counted in the total but missing from the header.
- CI pins Claude Code 2.1.289; the 2.1.287 floor is the first version with
  mods and is not tested on its own.
