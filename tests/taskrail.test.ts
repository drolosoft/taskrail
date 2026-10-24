import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { STALE_AFTER_MS, applyUpdates, cells, duration, markStale, newPlan, pad, renderBar, renderFull, renderText, staleTasks } from '../hooks/board'
import type { WaveBoardPlan } from '../types'

// A fixed instant, so the HH:MM in the header is the same on every run.
const NOON = new Date(2026, 9, 4, 12, 30).getTime()

// One minute, the unit of the times the board prints after a task.
const MINUTE = 60 * 1000

// What a person typing the command at the prompt looks like to the engine.
const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

// An example plan with three waves, cut to what the tests need.
const EXAMPLE = newPlan(
  {
    project: 'hopto',
    title: 'plan 7 · cleanup',
    goal: 'cleanup → main',
    description: 'A cleanup pass that changes no behaviour.',
    waves: [
      { name: 'A', tasks: ['T1', 'T2', 'T3'] },
      { name: 'B', tasks: ['T4', 'T5'] },
      { name: 'C', tasks: ['T6'] },
    ],
  },
  NOON,
)

/**
 * The world beneath the mod: a clock stopped at noon, an empty store and
 * a fixed session id.
 */
function mockWorld(on: On): void {
  mock.clock(on, { now: NOON })
  mock.store(on)
  // The store key of the plan carries the session id; the kit has none.
  on('session.id', () => ({ value: 'test-session' }))
}

test('emoji count two cells and a column pads to ten', async () => {
  expect(cells('├🟩 T1')).toBe(6)
  expect(cells(pad('├🟩 T1'))).toBe(10)
  expect(cells(pad('╰👀 T12'))).toBe(10)
})

test('a new plan starts every task pending and renders the rail', async () => {
  const lines = renderText(EXAMPLE, 40).split('\n')

  expect(lines[0]).toBe('╭' + '─'.repeat(40))
  expect(lines[1]).toBe('│ plan 7 · cleanup · 0 of 6 · 12:30 · 🥚 6')
  expect(lines).toContain('│ main 🥚 A 0/3 ┄🥚 B 0/2 ┄🥚 C 0/1 ┄▶ 🚀 cleanup → main')
  expect(lines).toContain('│      ├🥚 T1    ├🥚 T4    ╰🥚 T6')
  expect(lines).toContain('│      ╰🥚 T3')
  expect(lines[lines.length - 2]).toBe('│ ' + '🟥'.repeat(30) + ' 0/6')
})

test('set changes icons, keeps the layout and bolds the task in flight', async () => {
  const { plan, unknown } = applyUpdates(
    EXAMPLE,
    { tasks: { T1: '🟩', T2: '🟩', T3: '🟩', T4: '👀', T9: '🟩' }, note: '👀 T4 in review' },
    NOON,
  )

  expect(unknown).toEqual(['T9'])

  const text = renderText(plan, 40)
  expect(text).toContain('│ plan 7 · cleanup · 3 of 6 · 12:30 · 🟩 3 · 👀 1 · 🥚 2')
  expect(text).toContain('│ main 🟩 A 3/3 ━👀 B 0/2 ┄🥚 C 0/1 ┄▶ 🚀 cleanup → main')
  expect(text).toContain('│      ├🟩 T1    ├👀 T4    ╰🥚 T6')
  expect(text).toContain('│ 👀 T4 in review')
  expect(text).toContain('🟩'.repeat(15) + '🟨'.repeat(5) + '🟥'.repeat(10) + ' 3/6')

  const rows = renderFull(plan, 40)
  const t4 = rows.flat().find(segment => segment.text === 'T4')
  const t1 = rows.flat().find(segment => segment.text === 'T1')
  expect(t4?.bold).toBe(true)
  expect(t1?.bold).toBe(false)
})

test('the bar is one line with a station per wave and ten tiles', async () => {
  const { plan } = applyUpdates(EXAMPLE, { tasks: { T1: '🟩', T2: '🟩', T3: '🟩' } }, NOON)

  expect(renderBar(plan)).toBe(
    ' hopto · plan 7 · cleanup · 12:30 · A 🟩 3/3 ┄ B 🥚 0/2 ┄ C 🥚 0/1 ▶ 🚀 cleanup → main · 🟩🟩🟩🟩🟩🟥🟥🟥🟥🟥 3/6',
  )
})

test('the rules of a narrow board are exactly its width plus the border', async () => {
  const rules = renderText(EXAMPLE, 40).split('\n').filter(line => /^[╭├╰]/.test(line))

  // Title, description, rail and note rules, then the bottom.
  expect(rules.length).toBe(5)
  for (const line of rules) {
    expect(cells(line)).toBe(41)
  }
})

test('every icon reaches the header count and a stopped task outranks the rest', async () => {
  const { plan } = applyUpdates(EXAMPLE, { tasks: { T1: '🟩', T4: '🛑', T5: '👀', T6: '🚀' } }, NOON)
  const text = renderText(plan, 40)

  expect(text).toContain('│ plan 7 · cleanup · 1 of 6 · 12:30 · 🟩 1 · 👀 1 · 🚀 1 · 🛑 1 · 🥚 2')
  expect(text).toContain('│ main 🥚 A 1/3 ┄🛑 B 0/2 ┄🚀 C 0/1 ┄▶ 🚀 cleanup → main')
})

test('the tool results place the board above the prompt, as the band does', async ($, on) => {
  mockWorld(on)

  const planned = await $.tool.call({
    tool: 'mcp__taskrail__plan',
    project: 'demo',
    title: 'plan 1',
    goal: 'v1',
    waves: [{ name: 'A', tasks: ['T1'] }],
  })
  expect(String(planned.result)).toContain('above the prompt')
  expect(String(planned.result)).not.toContain('under the prompt')
})

test('set refuses to run before a plan exists', async ($, on) => {
  mockWorld(on)

  const refused = await $.tool.call({ tool: 'mcp__taskrail__set', tasks: { T1: '🟩' } })
  expect(refused.deny).toContain('no plan in this session')
})

test('the plan and set tools keep the board and answer the mode hint', async ($, on) => {
  mockWorld(on)

  const planned = await $.tool.call({
    tool: 'mcp__taskrail__plan',
    project: 'hopto',
    title: 'plan 8',
    goal: 'v1',
    waves: [{ name: 'A', tasks: ['T1', 'T2'] }],
  })
  expect(planned.deny).toBeUndefined()
  expect(String(planned.result)).toContain('plan 8 · 0 of 2 · 12:30')

  const changed = await $.tool.call({ tool: 'mcp__taskrail__set', tasks: { T1: '🟩' }, note: 'T2 pending' })
  expect(String(changed.result)).toContain('plan 8 · 1 of 2')
  expect(String(changed.result)).toContain('mode')

  const shown = await $.tool.call({ tool: 'mcp__taskrail__show' })
  expect(String(shown.result)).toContain('│      ├🟩 T1')
  expect(String(shown.result)).toContain('│ T2 pending')
})

test('/taskrail switches the mode, keeps it in the store and refuses what is not one', async ($, on) => {
  mockWorld(on)

  const bad = await $.command.run({ command: 'taskrail', args: 'loud', ...TYPED })
  expect(bad.text).toBe('usage: /taskrail [off|bar|full|both]')

  // Modes are lower case and documented so; spaces are forgiven, case is not.
  const shouted = await $.command.run({ command: 'taskrail', args: '  BAR  ', ...TYPED })
  expect(shouted.text).toBe('usage: /taskrail [off|bar|full|both]')

  const bar = await $.command.run({ command: 'taskrail', args: 'bar', ...TYPED })
  expect(bar.text).toBe('board: mode bar')

  const asked = await $.command.run({ command: 'taskrail', args: '', ...TYPED })
  expect(asked.text).toBe('board: mode bar (no plan in this session)')
})

test('the band draws the board on the terminal and the desktop, and nothing when off', async ($, on) => {
  mockWorld(on)
  // Off, the mod passes the band on; the engine beneath it is this hook,
  // registered before the first call on `$`, as the kit requires.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: ['the engine drew this'] })
  })

  await $.tool.call({
    tool: 'mcp__taskrail__plan',
    project: 'hopto',
    title: 'plan 9',
    goal: 'v2',
    waves: [{ name: 'A', tasks: ['T1'] }],
  })
  await $.command.run({ command: 'taskrail', args: 'full', ...TYPED })

  const band = {
    plugin: 'taskrail',
    component: 'AbovePrompt',
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 20,
      bodyColumns: 80,
      scroll: { offset: 0, bodyRows: 20 },
      view: {},
    },
  } as const

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...band, surface })
    expect(await ui.find({ type: 'Text', text: 'plan 9' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'T1' })).toBeDefined()
    await ui.unmount()
  }

  await $.command.run({ command: 'taskrail', args: 'bar', ...TYPED })
  const barred = await $.ui.mount({ ...band, surface: 'terminal' })
  expect(await barred.find({ type: 'Text', text: /hopto · plan 9 · 12:30 · A 🥚 0\/1/ })).toBeDefined()
  await barred.unmount()

  await $.command.run({ command: 'taskrail', args: 'off', ...TYPED })
  const hidden = await $.ui.mount({ ...band, surface: 'terminal' })
  expect(await hidden.find({ type: 'Text', text: /plan 9/ })).toBeUndefined()
  expect(await hidden.find({ type: 'Text', text: 'the engine drew this' })).toBeDefined()
  await hidden.unmount()
})

test('/clear reloads the mode and drops the plan, even one stored under the same session id', async ($, on) => {
  mock.clock(on, { now: NOON })
  // The engine gives /clear a new session id; the same id is kept here to
  // prove the plan is dropped by the mod and not by a key that moved.
  mock.store(on, { mode: 'off', 'plan:test-session': EXAMPLE })
  on('session.id', () => ({ value: 'test-session' }))
  // No settings hook is configured beneath, so the bottom answers nothing.
  on('classic.SessionStart', () => ({}))

  // The atom's default shows: session.start's own load did not reach the test.
  expect((await $.command.run({ command: 'taskrail', args: '', ...TYPED })).text).toContain('mode full')

  await $.classic.SessionStart({ source: 'clear' })
  expect((await $.command.run({ command: 'taskrail', args: '', ...TYPED })).text).toBe(
    'board: mode off (no plan in this session)',
  )
})

test('/resume reloads the mode and the plan from the store', async ($, on) => {
  mock.clock(on, { now: NOON })
  // A plan a previous version wrote: same shape, so it loads unchanged.
  mock.store(on, { mode: 'off', 'plan:test-session': EXAMPLE })
  on('session.id', () => ({ value: 'test-session' }))
  on('classic.SessionStart', () => ({}))

  await $.classic.SessionStart({ source: 'resume' })
  // No "(no plan in this session)" suffix: the stored plan loaded too.
  expect((await $.command.run({ command: 'taskrail', args: '', ...TYPED })).text).toBe('board: mode off')
})

// The band's props as the terminal stamps them, with no survey up.
const BAND = {
  plugin: 'taskrail',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 80, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

// The line another mod beneath this one draws (envrail's, say).
const OTHER_LINE = '🌐 auris │ 📦 prod 3df4d5e ✅ │ 🕐 12:30'

/** Starts a one-wave plan through the tool, as the model would. */
async function startPlan($: Engine): Promise<void> {
  await $.tool.call({ tool: 'mcp__taskrail__plan', project: 'hopto', title: 'plan 9', goal: 'v2', waves: [{ name: 'A', tasks: ['T1'] }] })
}

/** The texts of a mounted band, top to bottom. */
async function bandTexts(ui: { findAll: (query: { type: 'Text' }) => Promise<{ text: string }[]> }): Promise<string[]> {
  const texts = await ui.findAll({ type: 'Text' })

  return texts.map(text => text.text)
}

test('the board keeps what another mod drew beneath and goes after it, in bar and full', async ($, on) => {
  mockWorld(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ dimColor: true, children: [OTHER_LINE] })
  })

  await startPlan($)

  await $.command.run({ command: 'taskrail', args: 'bar', ...TYPED })
  const barred = await $.ui.mount(BAND)
  const barTexts = await bandTexts(barred)
  expect(barTexts[0]).toBe(OTHER_LINE)
  expect(barTexts[1]).toMatch(/hopto · plan 9 · 12:30/)
  expect(barTexts).toHaveLength(2)
  await barred.unmount()

  await $.command.run({ command: 'taskrail', args: 'full', ...TYPED })
  const full = await $.ui.mount(BAND)
  const fullTexts = await bandTexts(full)
  expect(fullTexts[0]).toBe(OTHER_LINE)
  expect(fullTexts.slice(1).some(text => text.includes('plan 9'))).toBe(true)
  await full.unmount()
})

test('the agent events move a task on their own: 🔧 on spawn, 🔑 on a permission, 👀 at the end', async ($, on) => {
  mockWorld(on)
  // The engine beneath: a spawn that starts an agent, a permission the
  // person answers, a turn that ends.
  on('agent.spawn', () => ({ model: 'opus', agentId: 'ag-1' }))
  on('classic.PermissionRequest', () => ({}))
  on('turn.complete', () => ({ text: '' }))

  await startPlan($)

  /** The task rows of the board, as `show` prints them. */
  async function board(): Promise<string> {
    return String((await $.tool.call({ tool: 'mcp__taskrail__show' })).result)
  }

  // A spawn as the engine stamps it: the Agent tool's call, the resolved
  // type and the loop that asked for it.
  await $.agent.spawn({
    tool_use_id: 'toolu-1',
    prompt: 'Implement the first task',
    description: 'Implement T1',
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'opus',
    background: false,
    fork: false,
  })
  expect(await board()).toContain('🔧 T1')

  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' }, agent_id: 'ag-1' })
  expect(await board()).toContain('🔑 T1')

  // A test's `$.tool.call` runs in the session's own loop and carries no
  // `agentId`, so the release on the agent's next call is proven on the
  // pure rule alone (tests/auto.test.ts); a held task that answers goes
  // to review the same way a working one does.
  await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 'turn-1', agentId: 'ag-1', reason: 'answer' })
  expect(await board()).toContain('👀 T1')

  // The main loop's own events name no agent and leave the board alone.
  await $.turn.complete({ answer: 'done', durationMs: 5, isAborted: false, turnId: 'turn-2', reason: 'error' })
  expect(await board()).toContain('👀 T1')
})

test('with nothing drawn beneath the board is alone, and a survey takes the band whole', async ($, on) => {
  mockWorld(on)
  // Beneath, no other mod: the engine answers with its own node, which
  // draws nothing in the band while no survey holds it.
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))

  await startPlan($)
  await $.command.run({ command: 'taskrail', args: 'bar', ...TYPED })

  const alone = await $.ui.mount(BAND)
  expect(await bandTexts(alone)).toHaveLength(1)
  expect(await alone.drawn()).toMatchObject({ children: [{ type: 'engine', ref: 0 }, { type: 'Box' }] })
  await alone.unmount()

  const surveyed = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true } })
  expect(await surveyed.drawn()).toEqual({ type: 'engine', ref: 0 })
  await surveyed.unmount()
})

test('set turns ✅ into 🟩 and keeps the old icon when the new one is not on the board', () => {
  const { plan, rejected } = applyUpdates(
    EXAMPLE,
    { tasks: { T1: '✅', T2: '✔️', T3: '☑️', T4: '⚡' } },
    NOON,
  )

  // The three aliases of "done" count as merged, the unknown icon is
  // refused and named so the model can correct itself.
  expect(rejected).toEqual([['T4', '⚡']])

  const text = renderText(plan, 40)
  expect(text).toContain('│ plan 7 · cleanup · 3 of 6 · 12:30 · 🟩 3 · 🥚 3')
  expect(text).toContain('│      ├🟩 T1    ├🥚 T4    ╰🥚 T6')
})

test('a duration is minutes under an hour and hours with two-digit minutes above', () => {
  expect(duration(12 * MINUTE)).toBe('12m')
  expect(duration(59 * MINUTE + 59 * 1000)).toBe('59m')
  expect(duration(72 * MINUTE)).toBe('1h12m')
  expect(duration(125 * MINUTE)).toBe('2h05m')
})

test('a task in flight shows how long it has run, a finished one how long it took, a pending one nothing', () => {
  const started = applyUpdates(EXAMPLE, { tasks: { T1: '🔧', T4: '🔧' } }, NOON).plan
  const finished = applyUpdates(started, { tasks: { T1: '🟩' } }, NOON + 48 * MINUTE).plan
  const lines = renderText(finished, 40, NOON + 72 * MINUTE).split('\n')

  // Each wave's column widens to fit its longest task with its time, and
  // its station on the rail widens with it, so the tasks still hang under
  // their own station.
  expect(lines).toContain('│ main 🥚 A 1/3    ┄🔧 B 0/2      ┄🥚 C 0/1 ┄▶ 🚀 cleanup → main')
  expect(lines).toContain('│      ├🟩 T1 · 48m ├🔧 T4 · 1h12m ╰🥚 T6')
  expect(lines).toContain('│      ├🥚 T2       ╰🥚 T5')

  // The header keeps the time of the last write, not the time of the draw.
  expect(lines[1]).toBe('│ plan 7 · cleanup · 1 of 6 · 13:18 · 🟩 1 · 🔧 1 · 🥚 4')

  // The time is plain text: only the id of a task in flight goes bold.
  const segments = renderFull(finished, 40, NOON + 72 * MINUTE).flat()
  expect(segments.find(segment => segment.text === ' · 1h12m')?.bold).not.toBe(true)
})

test('a task that moves within the minute it started shows no time', () => {
  const { plan } = applyUpdates(EXAMPLE, { tasks: { T1: '🟩', T4: '🔧' } }, NOON)

  expect(renderText(plan, 40, NOON + 30 * 1000)).toContain('│      ├🟩 T1    ├🔧 T4    ╰🥚 T6')
})

// A plan as versions before task times stored it: every task a bare id and
// icon pair, two of them already under way.
const UNTIMED: WaveBoardPlan = {
  ...EXAMPLE,
  waves: [
    { name: 'A', tasks: [['T1', '🟩'], ['T2', '🥚'], ['T3', '🥚']] },
    { name: 'B', tasks: [['T4', '🔧'], ['T5', '🥚']] },
    { name: 'C', tasks: [['T6', '🥚']] },
  ],
}

test('a plan saved before task times loads and draws with no time, and times the tasks that move after', async ($, on) => {
  const clock = mock.clock(on, { now: NOON })
  mock.store(on, { 'plan:test-session': UNTIMED })
  on('session.id', () => ({ value: 'test-session' }))
  on('classic.SessionStart', () => ({}))

  await $.classic.SessionStart({ source: 'resume' })
  await clock.advance(90 * MINUTE)

  // Nobody knows when T4 started, so it shows no time rather than a wrong one.
  const loaded = String((await $.tool.call({ tool: 'mcp__taskrail__show' })).result)
  expect(loaded).toContain('│      ├🟩 T1    ├🔧 T4    ╰🥚 T6')

  await $.tool.call({ tool: 'mcp__taskrail__set', tasks: { T4: '🟩', T5: '🔧' } })
  await clock.advance(12 * MINUTE)

  // T4 still has no start to count from; T5 started with this set, and its
  // time widens wave B for both of its tasks.
  const moved = String((await $.tool.call({ tool: 'mcp__taskrail__show' })).result)
  expect(moved).toContain('│      ├🟩 T1    ├🟩 T4       ╰🥚 T6')
  expect(moved).toContain('│      ├🥚 T2    ╰🔧 T5 · 12m')
})

test('staleTasks names the tasks in a running stage that nothing touched for longer than the limit', () => {
  const started = applyUpdates(EXAMPLE, { tasks: { T1: '🔧', T2: '👀', T3: '🔑', T4: '🧪', T5: '🟩' } }, NOON).plan
  const touched = applyUpdates(started, { tasks: { T2: '👀' } }, NOON + 10 * MINUTE).plan

  // T2 was confirmed ten minutes in, T3 waits for the person and T5 is
  // done: only T1 and T4 have gone a quarter of an hour without news.
  expect(staleTasks(touched, NOON + 16 * MINUTE, STALE_AFTER_MS)).toEqual(['T1', 'T4'])

  // Older than the limit, not as old as it.
  expect(staleTasks(touched, NOON + 15 * MINUTE, STALE_AFTER_MS)).toEqual([])

  // A task stored before the times existed has nothing to be old against.
  expect(staleTasks(UNTIMED, NOON + 99 * MINUTE, STALE_AFTER_MS)).toEqual([])
})

test('a stale task turns 🧟 and keeps the key line, and the next set moves it on', () => {
  const started = applyUpdates(EXAMPLE, { tasks: { T1: '🔧', T4: '🔧' }, note: '🔧 T1 and T4 at once' }, NOON).plan
  const { plan: marked, stale } = markStale(started, NOON + 20 * MINUTE, STALE_AFTER_MS)

  expect(stale).toEqual(['T1', 'T4'])

  const text = renderText(marked, 40, NOON + 20 * MINUTE)
  expect(text).toContain('├🧟 T1 · 20m')
  expect(text).toContain('│ 🔧 T1 and T4 at once')

  // Nothing stale: the same plan comes back, so nothing is written.
  expect(markStale(started, NOON + MINUTE, STALE_AFTER_MS).plan).toBe(started)

  const moved = applyUpdates(marked, { tasks: { T1: '🔧' } }, NOON + 21 * MINUTE).plan
  expect(renderText(moved, 40, NOON + 21 * MINUTE)).toContain('├🔧 T1 · 21m')
})

test('set, show and the band turn a task nobody touched for fifteen minutes into 🧟', async ($, on) => {
  const clock = mock.clock(on, { now: NOON })
  mock.store(on)
  on('session.id', () => ({ value: 'test-session' }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }))

  await $.tool.call({ tool: 'mcp__taskrail__plan', project: 'hopto', title: 'plan 9', goal: 'v2', waves: [{ name: 'A', tasks: ['T1', 'T2'] }] })
  await $.tool.call({ tool: 'mcp__taskrail__set', tasks: { T1: '🔧', T2: '🔧' }, note: 'both at once' })

  // T2 is confirmed ten minutes in; T1 hears nothing more.
  await clock.advance(10 * MINUTE)
  await $.tool.call({ tool: 'mcp__taskrail__set', tasks: { T2: '🔧' } })
  await clock.advance(6 * MINUTE)

  // The band cannot write while it draws, but it already shows the zombie.
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: '├🧟 ' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: '╰🔧 ' })).toBeDefined()
  await band.unmount()

  const shown = String((await $.tool.call({ tool: 'mcp__taskrail__show' })).result)
  expect(shown).toContain('├🧟 T1 · 16m')
  expect(shown).toContain('╰🔧 T2 · 16m')
  expect(shown).toContain('│ both at once')

  // The zombie is stored, and a set brings it back as any other move.
  const revived = await $.tool.call({ tool: 'mcp__taskrail__set', tasks: { T1: '🩹' } })
  expect(String(revived.result)).toContain('🔧 1 · 🩹 1')
})
