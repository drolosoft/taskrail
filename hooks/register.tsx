// The wave board as a mod: the plan of this session lives in `$.state`
// (reactive, survives a hot reload) with a copy in `$.store` per session id
// (survives /clear, /resume and a restart). The band above the prompt draws
// it; `/taskrail` picks the mode; the model updates it through three tools.
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
  planFromLegacy,
  renderBar,
  renderFull,
  renderText,
} from './board'
import type { PlanInput, SetInput } from './board'

// The plan of the session, null until the model creates one.
const plan = atom({ plugin: 'taskrail', key: 'plan' } as const, null)

// What the band shows. `full` is what Juan runs by default (2026-10-03).
const mode = atom({ plugin: 'taskrail', key: 'mode' } as const, 'full')

// The store key of the mode, shared by every session on this machine.
const MODE_KEY = 'mode'

// The folder the old scripts keep their state in, under $HOME.
const LEGACY_DIR = '.claude/wave-board'

/** The store key of this session's plan. */
async function planKey($: EngineInterface): Promise<string> {
  return `plan:${await $.session.id()}`
}

/**
 * Writes the plan to the state (redraws the band) and to the store (so it
 * outlives /clear and a restart).
 */
async function savePlan($: EngineInterface, next: WaveBoardPlan): Promise<void> {
  await update($, plan, () => next)
  await $.store.set(await planKey($), next)
}

/**
 * Loads the session's plan: the store first, then the state.json the old
 * scripts wrote for this session id, else nothing.
 */
async function loadPlan($: EngineInterface): Promise<void> {
  const stored = await $.store.get(await planKey($))

  if (stored !== undefined) {
    await update($, plan, () => stored as WaveBoardPlan)
    return
  }

  const home = await $.env.get('HOME')
  const id = await $.session.id()
  const legacyPath = `${home}/${LEGACY_DIR}/sessions/${id}/state.json`

  if (home === undefined || !(await $.fs.exists(legacyPath))) {
    return
  }

  const legacy = planFromLegacy(await $.fs.read(legacyPath), await $.clock.now())

  if (legacy !== null) {
    await savePlan($, legacy)
  }
}

/**
 * Loads the mode: the store, else the mode file of the old scripts, so the
 * first run of the mod shows what Juan last chose with the old `wb` script.
 */
async function loadMode($: EngineInterface): Promise<void> {
  const stored = await $.store.get(MODE_KEY)

  if (isMode(stored)) {
    await update($, mode, () => stored)
    return
  }

  const home = await $.env.get('HOME')
  const legacyPath = `${home}/${LEGACY_DIR}/mode`

  if (home === undefined || !(await $.fs.exists(legacyPath))) {
    return
  }

  const legacy = (await $.fs.read(legacyPath)).trim()

  if (isMode(legacy)) {
    await update($, mode, () => legacy)
    await $.store.set(MODE_KEY, legacy)
  }
}

/** The input schema of the `plan` tool. */
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Short project name, shown first in the bar (hopto, laporra-go).' },
    title: { type: 'string', description: 'The plan as the header names it: "plan 7 · limpieza".' },
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'taskrail',
      description: 'Wave board under the prompt: off, bar, full or both',
      argumentHint: '[off|bar|full|both]',
      immediate: true,
    })
    await $.tool.register({
      name: 'plan',
      description:
        'Starts (or replaces) the wave board of this session: the plan\'s project, title, goal, description and its waves of task ids. Every task starts 🥚. The board is drawn under the prompt by the mod; call `set` on every state change.',
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
        'Returns the whole board as text, to paste in the chat inside a fenced code block when Juan asks for it (mode off) or at every milestone (mode both). Never in modes bar or full.',
    })

    await loadMode($)
    await loadPlan($)

    return next(e)
  })

  // /clear, /resume and /branch reset every `$.state` value and fire no
  // `session.start`; the classic event does, with the source that says so.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await loadMode($)
    await loadPlan($)

    return next(e)
  })

  on('command.run', { command: 'taskrail' }, async ($, e) => {
    const wanted = e.args.trim()
    const current = await read($, mode)

    if (wanted === '') {
      const hasPlan = (await read($, plan)) !== null
      return { text: `tablero: modo ${current}${hasPlan ? '' : ' (sin plan en esta sesión)'}` }
    }

    if (!isMode(wanted)) {
      return { text: `uso: /taskrail [${MODES.join('|')}]` }
    }

    await update($, mode, () => wanted)
    await $.store.set(MODE_KEY, wanted)

    return { text: `tablero: modo ${wanted}` }
  })

  on('tool.call', { tool: 'mcp__taskrail__plan' }, async ($, e) => {
    const input = e as unknown as PlanInput

    if (!Array.isArray(input.waves) || input.waves.length === 0) {
      return { deny: 'taskrail: a plan needs at least one wave with its task ids.' }
    }

    const created = newPlan(input, await $.clock.now())
    await savePlan($, created)

    return { result: `${headerLine(created)}\n${modeHint(await read($, mode))}` }
  })

  on('tool.call', { tool: 'mcp__taskrail__set' }, async ($, e) => {
    const current = await read($, plan)

    if (current === null) {
      return { deny: 'taskrail: no plan in this session yet; create one with mcp__taskrail__plan.' }
    }

    const { plan: changed, unknown } = applyUpdates(current, e as unknown as SetInput, await $.clock.now())
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
