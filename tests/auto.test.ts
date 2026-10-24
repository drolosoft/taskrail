import { expect, test } from 'claude-code/testing'

import { iconOf, onComplete, onPermission, onSpawn, onToolStart, taskOf } from '../hooks/auto'
import { applyUpdates, newPlan } from '../hooks/board'
import type { AgentLinks, TaskTimes, WaveBoardPlan } from '../types'

// A fixed instant; the rules stamp it as the plan's last write.
const NOON = new Date(2026, 9, 17, 12, 30).getTime()

// Two waves whose ids overlap as prefixes (T1 / T12) and as words (rev / review).
const PLAN = newPlan(
  {
    project: 'hopto',
    title: 'plan 9',
    goal: 'v2',
    waves: [
      { name: 'A', tasks: ['T1', 'T12', 'CI/CD'] },
      { name: 'B', tasks: ['rev'] },
    ],
  },
  NOON,
)

// One minute, for the times the rules stamp on a task.
const MINUTE = 60 * 1000

// No agent linked yet.
const NONE: AgentLinks = {}

/** The times a plan keeps for one task, or undefined when it keeps none. */
function timesOf(plan: WaveBoardPlan, id: string): TaskTimes | undefined {
  const task = plan.waves.flatMap(wave => wave.tasks).find(candidate => candidate[0] === id)

  return task?.[2]
}

/** The plan with one task moved by hand, as the model's `set` would. */
function moved(plan: WaveBoardPlan, id: string, icon: string): WaveBoardPlan {
  return applyUpdates(plan, { tasks: { [id]: icon } }, NOON).plan
}

test('taskOf finds an id as a whole word, longest first, description before name', async () => {
  expect(taskOf(PLAN, 'Implement T1 end to end')).toBe('T1')
  expect(taskOf(PLAN, 'T12: the parser')).toBe('T12')
  expect(taskOf(PLAN, 'fix T120')).toBe(null)
  expect(taskOf(PLAN, 'code review of the branch')).toBe(null)
  expect(taskOf(PLAN, 'rev: second pass')).toBe('rev')
  expect(taskOf(PLAN, 'wire CI/CD')).toBe('CI/CD')
  expect(taskOf(PLAN, 'something else', 'T1-worker')).toBe('T1')
  expect(taskOf(PLAN, 'T12 then T1')).toBe('T12')
  expect(taskOf(PLAN, undefined, '')).toBe(null)
})

test('a spawn for a pending task makes it 🔧 and links the agent', async () => {
  const spawned = onSpawn(PLAN, NONE, { agentId: 'ag-1', description: 'Implement T1' }, NOON)

  expect(spawned.changed).toBe(true)
  expect(iconOf(spawned.plan, 'T1')).toBe('🔧')
  expect(spawned.links).toEqual({ 'ag-1': { task: 'T1', before: null } })
})

test('a spawn for a task in review keeps its icon but is linked all the same', async () => {
  const reviewing = moved(PLAN, 'T1', '👀')
  const spawned = onSpawn(reviewing, NONE, { agentId: 'ag-2', description: 'Review T1' }, NOON)

  expect(spawned.changed).toBe(true)
  expect(iconOf(spawned.plan, 'T1')).toBe('👀')
  expect(spawned.links['ag-2']).toEqual({ task: 'T1', before: null })
})

test('a spawn that names no task changes nothing', async () => {
  const spawned = onSpawn(PLAN, NONE, { agentId: 'ag-3', description: 'Explore the repo' }, NOON)

  expect(spawned.changed).toBe(false)
  expect(spawned.plan).toBe(PLAN)
  expect(spawned.links).toBe(NONE)
})

test('a permission request holds a running task at 🔑 and remembers its icon', async () => {
  const { plan, links } = onSpawn(PLAN, NONE, { agentId: 'ag-1', description: 'T1' }, NOON)
  const held = onPermission(plan, links, 'ag-1', NOON)

  expect(held.changed).toBe(true)
  expect(iconOf(held.plan, 'T1')).toBe('🔑')
  expect(held.links['ag-1']).toEqual({ task: 'T1', before: '🔧' })

  // An unlinked agent, or a task that is not running, is left alone.
  expect(onPermission(plan, links, 'ag-9', NOON).changed).toBe(false)
  expect(onPermission(PLAN, { 'ag-1': { task: 'T12', before: null } }, 'ag-1', NOON).changed).toBe(false)
})

test('the next tool call of the agent gives the held icon back, unless the model moved the task', async () => {
  const { plan, links } = onSpawn(PLAN, NONE, { agentId: 'ag-1', description: 'T1' }, NOON)
  const held = onPermission(plan, links, 'ag-1', NOON)

  const released = onToolStart(held.plan, held.links, 'ag-1', NOON)
  expect(released.changed).toBe(true)
  expect(iconOf(released.plan, 'T1')).toBe('🔧')
  expect(released.links['ag-1']).toEqual({ task: 'T1', before: null })

  const tested = moved(held.plan, 'T1', '🧪')
  const kept = onToolStart(tested, held.links, 'ag-1', NOON)
  expect(iconOf(kept.plan, 'T1')).toBe('🧪')
  expect(kept.links['ag-1']?.before).toBe(null)

  // Nothing held: nothing to give back.
  expect(onToolStart(released.plan, released.links, 'ag-1', NOON).changed).toBe(false)
})

test('the end of a turn hands work to review, breaks it or stops it, and never touches settled work', async () => {
  const { plan, links } = onSpawn(PLAN, NONE, { agentId: 'ag-1', description: 'T1' }, NOON)

  expect(iconOf(onComplete(plan, links, { agentId: 'ag-1', reason: 'answer' }, NOON).plan, 'T1')).toBe('👀')
  expect(iconOf(onComplete(plan, links, { agentId: 'ag-1', reason: 'error' }, NOON).plan, 'T1')).toBe('💥')
  expect(iconOf(onComplete(plan, links, { agentId: 'ag-1', reason: 'refusal' }, NOON).plan, 'T1')).toBe('💥')
  expect(iconOf(onComplete(plan, links, { agentId: 'ag-1', reason: 'aborted' }, NOON).plan, 'T1')).toBe('🛑')

  // A held task that answers was working: it goes to review too.
  const held = onPermission(plan, links, 'ag-1', NOON)
  expect(iconOf(onComplete(held.plan, held.links, { agentId: 'ag-1', reason: 'answer' }, NOON).plan, 'T1')).toBe('👀')

  // A reviewer's answer does not move a task already in review.
  const reviewing = moved(plan, 'T1', '👀')
  expect(onComplete(reviewing, links, { agentId: 'ag-1', reason: 'answer' }, NOON).changed).toBe(false)

  // Merged or shipped work is over, whatever the agent did.
  const merged = moved(plan, 'T1', '🟩')
  expect(onComplete(merged, links, { agentId: 'ag-1', reason: 'error' }, NOON).changed).toBe(false)

  // An agent nobody linked says nothing about the plan.
  expect(onComplete(plan, NONE, { agentId: 'ag-1', reason: 'answer' }, NOON).changed).toBe(false)
})

test('the events stamp the times a task moved: started on the spawn, touched again at the end', async () => {
  const spawned = onSpawn(PLAN, NONE, { agentId: 'ag-1', description: 'Implement T1' }, NOON)
  expect(timesOf(spawned.plan, 'T1')).toEqual({ touchedAt: NOON, startedAt: NOON, doneAt: null })

  const answered = onComplete(spawned.plan, spawned.links, { agentId: 'ag-1', reason: 'answer' }, NOON + 20 * MINUTE)
  expect(timesOf(answered.plan, 'T1')).toEqual({ touchedAt: NOON + 20 * MINUTE, startedAt: NOON, doneAt: null })

  // Merged by the model later: the total runs from the spawn to the merge.
  const merged = applyUpdates(answered.plan, { tasks: { T1: '🟩' } }, NOON + 48 * MINUTE).plan
  expect(timesOf(merged, 'T1')).toEqual({ touchedAt: NOON + 48 * MINUTE, startedAt: NOON, doneAt: NOON + 48 * MINUTE })

  // A task nobody named keeps no times.
  expect(timesOf(merged, 'T12')).toBeUndefined()
})

test('a linked agent\'s tool calls keep its task fresh, at most one write a minute', async () => {
  const { plan, links } = onSpawn(PLAN, NONE, { agentId: 'ag-1', description: 'T1' }, NOON)

  // Within the minute the touch is recent enough: nothing is written.
  expect(onToolStart(plan, links, 'ag-1', NOON + 30 * 1000).changed).toBe(false)

  const fresh = onToolStart(plan, links, 'ag-1', NOON + 14 * MINUTE)
  expect(fresh.changed).toBe(true)
  expect(iconOf(fresh.plan, 'T1')).toBe('🔧')
  expect(timesOf(fresh.plan, 'T1')).toEqual({ touchedAt: NOON + 14 * MINUTE, startedAt: NOON, doneAt: null })

  // A task that is not in a running stage is not the agent's to keep alive.
  const merged = moved(plan, 'T1', '🟩')
  expect(onToolStart(merged, links, 'ag-1', NOON + 14 * MINUTE).changed).toBe(false)
})

test('a stale task leaves 🧟 on the next event: 🔧 on a spawn, 👀 when its agent answers', async () => {
  const { plan, links } = onSpawn(PLAN, NONE, { agentId: 'ag-1', description: 'T1' }, NOON)
  const stale = moved(plan, 'T1', '🧟')

  expect(iconOf(onComplete(stale, links, { agentId: 'ag-1', reason: 'answer' }, NOON).plan, 'T1')).toBe('👀')
  expect(iconOf(onSpawn(stale, NONE, { agentId: 'ag-2', description: 'Retry T1' }, NOON).plan, 'T1')).toBe('🔧')
})
