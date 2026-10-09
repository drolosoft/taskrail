import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { applyUpdates, cells, newPlan, pad, renderBar, renderFull, renderText } from '../hooks/board'

// A fixed instant, so the HH:MM in the header is the same on every run.
const NOON = new Date(2026, 9, 4, 12, 30).getTime()

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
