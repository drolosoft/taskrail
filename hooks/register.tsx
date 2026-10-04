// The wave board as a mod: the plan of this session lives in `$.state`
// (reactive, survives a hot reload) with a copy in `$.store` per session id
// (survives /resume and a restart; /clear drops it). The band above the
// prompt draws it; `/taskrail` picks the mode; the model updates it through
// three tools.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { WaveBoardMode, WaveBoardPlan } from '../types'
import {
  applyUpdates,
  headerLine,
  isMode,
  MODES,
  modeHint,
  newPlan,
  renderBar,
  renderFull,
  renderText,
} from './board'

// The plan of the session, null until the model creates one.
const plan = atom({ plugin: 'taskrail', key: 'plan' } as const, null)

// What the band shows; the whole board by default.
const mode = atom({ plugin: 'taskrail', key: 'mode' } as const, 'full')

// The store key of the mode, shared by every session on this machine.
const MODE_KEY = 'mode'

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
      description: 'Task id to new icon: {"T4": "🟩", "T5": "👀"}. Icons: 🥚 🔧 👀 🩹 🧪 🟩 🚀 🔑 👻 🧟 💥 🥱 🛑.',
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
  } catch {
    // The user's own /taskrail stays; the tools still carry the board.
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
        'Starts (or replaces) the wave board of this session: the plan\'s project, title, goal, description and its waves of task ids. Every task starts 🥚. The board is drawn above the prompt by the mod; call `set` on every state change.',
      inputSchema: PLAN_SCHEMA,
    })
    await $.tool.register({
      name: 'set',
      description:
        'Updates the wave board of this session: task icons by id, the key line (note), goal, title or description. Call it on EVERY state change (an implementer reports, a review lands, a merge, CI), never by editing files. Its result says what the current mode asks of the chat.',
      inputSchema: SET_SCHEMA,
    })
    await $.tool.register({
      name: 'show',
      description:
        'Returns the whole board as text, to paste in the chat inside a fenced code block when the user asks for it (mode off) or at every milestone (mode both). Never in modes bar or full.',
    })

    await loadMode($)
    await loadPlan($)

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
    await savePlan($, created)

    return { result: `${headerLine(created)}\n${modeHint(await read($, mode))}` }
  })

  on('tool.call', { tool: 'mcp__taskrail__set' }, async ($, e) => {
    const current = await read($, plan)

    if (current === null) {
      return { deny: 'taskrail: no plan in this session yet; create one with mcp__taskrail__plan.' }
    }

    const { plan: changed, unknown } = applyUpdates(current, e, await $.clock.now())
    await savePlan($, changed)

    const warning = unknown.length > 0 ? `\nunknown task ids, ignored: ${unknown.join(', ')}` : ''

    return { result: `${headerLine(changed)}${warning}\n${modeHint(await read($, mode))}` }
  })

  on('tool.call', { tool: 'mcp__taskrail__show' }, async $ => {
    const current = await read($, plan)

    if (current === null) {
      return { deny: 'taskrail: no plan in this session yet; create one with mcp__taskrail__plan.' }
    }

    return { result: renderText(current) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, plan)
    const shown: WaveBoardMode = await read($, mode)

    if (e.props.hasSurvey || current === null || shown === 'off') {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)

    if (shown === 'bar') {
      return (
        <Box>
          <Text wrap="truncate-end">{renderBar(current)}</Text>
        </Box>
      )
    }

    // The rules stretch to the band's width, as the status line script
    // stretched them to the terminal's; two cells short so nothing wraps.
    const width = Math.max(40, e.props.bodyColumns - 2)
    const lines = renderFull(current, width)

    return (
      <Box flexDirection="column">
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
