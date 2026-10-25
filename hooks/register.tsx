// The wave board as a mod: the plan of this session lives in `$.state`
// (reactive, survives a hot reload) with a copy in `$.store` per session id
// (survives /resume and a restart; /clear drops it). The band above the
// prompt draws it; `/taskrail` picks the mode; the model updates it through
// three tools, and the engine's own agent events move the tasks the model
// has not reported yet (hooks/auto.ts).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentLinks, WaveBoardMode, WaveBoardPlan } from '../types'
import { onComplete, onPermission, onSpawn, onToolStart } from './auto'
import type { AutoResult } from './auto'
import type { Segment } from './board'
import {
  DEFAULT_WIDTH,
  ICONS,
  STALE_AFTER_MS,
  applyUpdates,
  headerLine,
  isMode,
  markStale,
  MODES,
  modeHint,
  newPlan,
  renderBar,
  renderFull,
  renderText,
  serialWarnings,
} from './board'

// The plan of the session, null until the model creates one.
const plan = atom({ plugin: 'taskrail', key: 'plan' } as const, null)

// What the band shows; the whole board by default.
const mode = atom({ plugin: 'taskrail', key: 'mode' } as const, 'full')

// The subagents the engine reported, each tied to a task. Session state
// only: an agent does not outlive its session, so nothing goes to the store.
const links = atom({ plugin: 'taskrail', key: 'agents' } as const, {} as AgentLinks)

// The store key of the mode, shared by every session on this machine.
const MODE_KEY = 'mode'

// How often the timer looks for stale tasks and draws the band again when
// nothing else moves it: once a minute, the unit the time after each task
// in flight is counted in, and a fifteenth of the stale limit. The same
// redraw is what takes a settled 🟩 task out of the rows (board.ts,
// HIDE_DONE_AFTER_MS) when no write happens to do it.
const TICK_EVERY_MS = 60 * 1000

// The last failure written to the transcript, so a hook that breaks on
// every event (a render, say) says so once and not on every redraw.
let lastFailure: string | null = null

/**
 * The text of an error for a log line, whatever was thrown.
 *
 * @param err what a call rejected with
 * @returns its message, or the value as text
 */
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Writes one dim line under the mod's name when a hook fails, instead of
 * letting the failure take the event down with it. The same text is not
 * repeated while it keeps happening.
 *
 * @param where the hook that failed
 * @param err what it threw
 */
function noteFailure($: EngineInterface, where: string, err: unknown): void {
  const text = `taskrail: ${where} failed: ${errorText(err)}`

  if (text === lastFailure) {
    return
  }

  lastFailure = text
  $.ui.log(text)
}

/** The store key of this session's plan. */
async function planKey($: EngineInterface): Promise<string> {
  return `plan:${await $.session.id()}`
}

/**
 * Writes the plan to the state (redraws the band) and to the store (so it
 * outlives /resume and a restart).
 */
async function savePlan($: EngineInterface, next: WaveBoardPlan): Promise<void> {
  await update($, plan, () => next)
  await $.store.set(await planKey($), next)
}

/** Loads the session's plan from the store, if any. */
async function loadPlan($: EngineInterface): Promise<void> {
  const stored = await $.store.get(await planKey($))

  if (stored !== undefined) {
    await update($, plan, () => stored as WaveBoardPlan)
  }
}

/**
 * Writes what an event rule decided: the plan when it moved a task, the
 * links when an agent was tied or released. A rule that changed nothing
 * writes nothing, so the band is not redrawn for every tool call.
 */
async function applyAuto($: EngineInterface, outcome: AutoResult): Promise<void> {
  if (!outcome.changed) {
    return
  }

  await update($, links, () => outcome.links)
  await savePlan($, outcome.plan)
}

/**
 * Turns the plan's stale tasks into 🧟 and writes it, when there are any.
 * @returns the plan as it stands after the check, null with no plan
 */
async function settleStale($: EngineInterface): Promise<WaveBoardPlan | null> {
  const current = await read($, plan)

  if (current === null) {
    return null
  }

  const { plan: marked, stale } = markStale(current, await $.clock.now(), STALE_AFTER_MS)

  if (stale.length > 0) {
    await savePlan($, marked)
  }

  return marked
}

/**
 * What the timer does once a minute: writes the tasks gone stale, then asks
 * the band to draw again. Every write of the plan redraws the band; between
 * writes the minutes after a task in flight would stand still.
 */
async function tick($: EngineInterface): Promise<void> {
  try {
    await settleStale($)
  } catch (err) {
    noteFailure($, 'timer', err)
  }

  $.ui.invalidate('ui.render')
}

/** Loads the mode the user last chose, kept in the store across sessions. */
async function loadMode($: EngineInterface): Promise<void> {
  const stored = await $.store.get(MODE_KEY)

  if (isMode(stored)) {
    await update($, mode, () => stored)
  }
}

/** The input schema of the `plan` tool. */
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Short project name, shown first in the bar ("shop", "api").' },
    title: { type: 'string', description: 'The plan as the header names it: "plan 7 · cleanup".' },
    goal: { type: 'string', description: 'What the rail ends in, after 🚀: "v0.1.0", "cleanup → main".' },
    description: { type: 'string', description: 'What the whole plan does, two lines at most; written once.' },
    note: { type: 'string', description: 'The key line: what is not 🟩 and what is being waited on.' },
    waves: {
      type: 'array',
      description: 'The waves in order; tasks with disjoint files and no consumer relation share a wave.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The station letter: A, B, C.' },
          tasks: { type: 'array', items: { type: 'string' }, description: 'Task ids, short: T1, T2, rev, CI.' },
        },
        required: ['name', 'tasks'],
      },
    },
  },
  required: ['project', 'title', 'goal', 'waves'],
}

/** The input schema of the `set` tool. */
const SET_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'object',
      description: 'Task id to new icon: {"T4": "🟩", "T5": "👀"}. Icons: 🥚 🔧 👀 🩹 🧪 🟩 🚀 🔑 👻 🧟 💥 🥱 🛑. ✅ is read as 🟩; any other icon is refused and the task keeps its own.',
      additionalProperties: { type: 'string' },
    },
    note: { type: 'string', description: 'Replaces the key line.' },
    goal: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string' },
  },
}

/**
 * Registers `/taskrail`. The engine refuses the name when the user already
 * has a skill or a command called `taskrail`, and the refusal throws; the
 * mod then runs without its command and the mode stays as it was.
 */
async function registerCommand($: EngineInterface): Promise<void> {
  try {
    await $.command.register({
      name: 'taskrail',
      description: 'Wave board above the prompt: off, bar, full or both',
      argumentHint: '[off|bar|full|both]',
      immediate: true,
    })
  } catch (err) {
    // The user's own /taskrail stays; the tools still carry the board. One
    // line says why the mod's command is missing, where a silent catch left
    // the person guessing.
    $.ui.log(`taskrail: /taskrail not registered (${errorText(err)}); the tools and the board still work`)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // A refused command must not take the rest of the hook down with it:
    // without the tools, the mode and the plan there is no board at all,
    // while without the command the board only keeps the mode it had.
    await registerCommand($)

    await $.tool.register({
      name: 'plan',
      description:
        'Starts (or replaces) the wave board of this session: the plan\'s project, title, goal, description and its waves of task ids. Every task starts 🥚. The board is drawn above the prompt by the mod. Put the task id in the description of every Agent call for it ("Implement T4"): the mod then follows the engine\'s events on its own (🔧 on spawn, 🔑 while the agent waits for approval, 👀/💥/🛑 when its turn ends); call `set` for what the engine cannot see.',
      inputSchema: PLAN_SCHEMA,
    })
    await $.tool.register({
      name: 'set',
      description:
        'Updates the wave board of this session: task icons by id, the key line (note), goal, title or description. The mod already moves a task from the engine\'s events when its id is in the Agent call\'s description (🔧 spawn, 🔑 waiting for approval, 👀/💥/🛑 at the turn\'s end); call `set` for everything else (🩹 🧪 🟩 🚀, a merge, CI, the note), never by editing files. What you set stays until an event has something new to say. A task in 🔧 👀 🩹 🧪 that nothing touches for 15 minutes turns 🧟 on its own; set it again to move it on. Its result says what the current mode asks of the chat.',
      inputSchema: SET_SCHEMA,
    })
    await $.tool.register({
      name: 'show',
      description:
        'Returns the whole board as text, to paste in the chat inside a fenced code block when the user asks for it (mode off) or at every milestone (mode both). Never in modes bar or full.',
    })

    await loadMode($)
    await loadPlan($)

    // The timer runs until the module reloads, which runs this hook again;
    // /clear and /resume keep it, as they keep the module.
    $.clock.every(TICK_EVERY_MS, () => {
      void tick($)
    })

    return next(e)
  })

  // /clear, /resume and /branch reset every `$.state` value and fire no
  // `session.start`; the classic event does, with the source that says so.
  on('classic.SessionStart', { source: ['resume', 'fork'] }, async ($, e, next) => {
    await loadMode($)
    await loadPlan($)

    return next(e)
  })

  // /clear starts over, and the plan goes with the conversation it belonged
  // to; only the mode comes back, because it is a preference of the machine.
  on('classic.SessionStart', { source: 'clear' }, async ($, e, next) => {
    await loadMode($)

    return next(e)
  })

  on('command.run', { command: 'taskrail' }, async ($, e) => {
    const wanted = e.args.trim()
    const current = await read($, mode)

    if (wanted === '') {
      const hasPlan = (await read($, plan)) !== null
      return { text: `board: mode ${current}${hasPlan ? '' : ' (no plan in this session)'}` }
    }

    if (!isMode(wanted)) {
      return { text: `usage: /taskrail [${MODES.join('|')}]` }
    }

    await update($, mode, () => wanted)
    await $.store.set(MODE_KEY, wanted)

    return { text: `board: mode ${wanted}` }
  })

  on('tool.call', { tool: 'mcp__taskrail__plan' }, async ($, e) => {
    if (!Array.isArray(e.waves) || e.waves.length === 0) {
      return { deny: 'taskrail: a plan needs at least one wave with its task ids.' }
    }

    const created = newPlan(e, await $.clock.now())
    // A new plan starts with no agent tied to it: the old links named tasks
    // of the plan it replaces.
    await update($, links, () => ({}))
    await savePlan($, created)

    return { result: `${headerLine(created)}\n${modeHint(await read($, mode))}` }
  })

  on('tool.call', { tool: 'mcp__taskrail__set' }, async ($, e) => {
    const current = await read($, plan)

    if (current === null) {
      return { deny: 'taskrail: no plan in this session yet; create one with mcp__taskrail__plan.' }
    }

    const now = await $.clock.now()
    const { plan: updated, unknown, rejected } = applyUpdates(current, e, now)

    // The tasks this call named were touched just now; any other one that
    // went quiet for too long is flagged in the same write.
    const { plan: changed } = markStale(updated, now, STALE_AFTER_MS)
    await savePlan($, changed)

    const warnings: string[] = []

    if (unknown.length > 0) {
      warnings.push(`unknown task ids, ignored: ${unknown.join(', ')}`)
    }

    // A refused icon is named with the valid list, so the next call fixes it
    // instead of leaving a task that never counts as done.
    if (rejected.length > 0) {
      const pairs = rejected.map(([id, icon]) => `${id} ${icon}`).join(', ')
      warnings.push(`unknown icons, tasks kept as they were: ${pairs}. Valid icons: ${ICONS}`)
    }

    // A wave whose tasks are being started one at a time is told so here,
    // where the model reads it, and never on the board the person sees.
    warnings.push(...serialWarnings(changed))

    const warning = warnings.map(line => `\n${line}`).join('')

    return { result: `${headerLine(changed)}${warning}\n${modeHint(await read($, mode))}` }
  })

  on('tool.call', { tool: 'mcp__taskrail__show' }, async $ => {
    const current = await settleStale($)

    if (current === null) {
      return { deny: 'taskrail: no plan in this session yet; create one with mcp__taskrail__plan.' }
    }

    return { result: renderText(current, DEFAULT_WIDTH, await $.clock.now()) }
  })

  // The engine's agent events, each one a rule of hooks/auto.ts over the
  // plan. Every hook passes the event on whatever happens: a rule that
  // throws is noted once and the spawn, the call or the turn goes through.

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)

    try {
      const current = await read($, plan)

      if (current !== null && result.agentId !== undefined) {
        const spawn = { agentId: result.agentId, description: e.description, name: e.name }

        await applyAuto($, onSpawn(current, await read($, links), spawn, await $.clock.now()))
      }
    } catch (err) {
      noteFailure($, 'agent.spawn', err)
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    try {
      const current = await read($, plan)

      if (current !== null && e.agentId !== undefined) {
        const end = { agentId: e.agentId, reason: e.reason }

        await applyAuto($, onComplete(current, await read($, links), end, await $.clock.now()))
      }
    } catch (err) {
      noteFailure($, 'turn.complete', err)
    }

    return next(e)
  })

  on('classic.PermissionRequest', async ($, e, next) => {
    try {
      const current = await read($, plan)

      if (current !== null && e.agent_id !== undefined) {
        await applyAuto($, onPermission(current, await read($, links), e.agent_id, await $.clock.now()))
      }
    } catch (err) {
      noteFailure($, 'PermissionRequest', err)
    }

    return next(e)
  })

  // Registered after the mod's own tool hooks: those answer without `next`,
  // and run on the main loop anyway, where there is no agent to release.
  on('tool.call', async ($, e, next) => {
    try {
      const current = await read($, plan)

      if (current !== null && e.agentId !== undefined) {
        await applyAuto($, onToolStart(current, await read($, links), e.agentId, await $.clock.now()))
      }
    } catch (err) {
      noteFailure($, 'tool.call', err)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, plan)
    const shown: WaveBoardMode = await read($, mode)

    if (e.props.hasSurvey || current === null || shown === 'off') {
      return next(e)
    }

    // The rules stretch to the band's width, as the status line script
    // stretched them to the terminal's; two cells short so nothing wraps.
    const width = Math.max(40, e.props.bodyColumns - 2)
    const now = await $.clock.now()

    // The drawing is computed before anything beneath is asked: a plan the
    // renderer cannot draw (one an older version stored, say) must leave
    // the band to the other mods, noted once, not take it down.
    let bar: string
    let lines: Segment[][]
    try {
      // A render hook may not write, so the board is drawn with its stale
      // tasks already marked and the timer stores them within the minute.
      const drawn = markStale(current, now, STALE_AFTER_MS).plan

      bar = renderBar(drawn)
      lines = renderFull(drawn, width, now)
    } catch (err) {
      noteFailure($, 'ui.render', err)

      return next(e)
    }

    // The band is one strip shared by every mod: what the hooks beneath this
    // one drew (envrail's line, say) is kept, never replaced. When nobody
    // beneath draws, the engine's own node draws nothing and the board is
    // alone.
    const others = await next(e)

    const { Box, Text } = $.ui.resolve(e)

    // The board goes after what it got. Short status lines stay on top,
    // where a band taller than its rows starts showing, and the board, the
    // one tree that can outgrow the band, is what scrolls; envrail puts its
    // line before what it gets, so the order holds whichever of the two
    // mods the engine calls first.
    if (shown === 'bar') {
      return (
        <Box flexDirection="column">
          {others}
          <Box>
            <Text wrap="truncate-end">{bar}</Text>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {others}
        {lines.map(segments => (
          <Box flexDirection="row">
            {segments.map(segment => (
              <Text bold={segment.bold === true} wrap="truncate-end">
                {segment.text}
              </Text>
            ))}
          </Box>
        ))}
      </Box>
    )
  })
}
