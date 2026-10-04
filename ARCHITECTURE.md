# Architecture

taskrail is a Claude Code mod: a plugin whose `hooks/hooks.json` names one
TypeScript module that the engine loads into the session. Everything the
mod does happens through the `$` object that module receives: session
state, the plugin store, the band above the prompt, a command and three
tools. There is no build step, no dependency and no process of its own.

## How it works

Two source files with one rule between them:

- `hooks/board.ts` holds the plan model and every drawing function
  (`renderFull`, `renderBar`, `renderText`, `headerLine`, `modeHint`,
  `newPlan`, `applyUpdates`). It never touches `$`, so it can be tested as
  plain functions and `claude plugin validate` can still see every engine
  call the mod makes.
- `hooks/register.tsx` is the only file that talks to the engine: it
  registers the `/taskrail` command and the `plan`, `set` and `show`
  tools at `session.start`, keeps the plan and the mode, and draws the
  band in `ui.render` for the `AbovePrompt` component.

`types/index.d.ts` declares the plan types and the shape of the mod's
state for the engine's type layer.

## Where the state lives

| What | Where | Why |
|---|---|---|
| The plan | session state (`$.state`, reactive) and the plugin store under `plan:<session id>` | the state redraws the band on every change; the store survives `/resume` and a restart followed by `--resume` |
| The mode | the plugin store under `mode`, one value per machine | the choice is a preference, not part of a plan |

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

## Drawing

- Emoji count as two terminal cells, but only those in the `EMOJI` set;
  box glyphs, Latin and digits count one. A new icon goes in that set first.
- The header counts the icons listed in `ORDER`; a wave's station shows
  the first icon of `URGENCY` found among its tasks, or 🟩 when every task
  is merged, or 🥚; the tiles are green for 🟩, yellow for the `RUNNING`
  icons (at least one tile while anything runs) and red for the rest.
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
