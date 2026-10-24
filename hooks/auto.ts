// What the engine's own events say about the tasks, kept free of `$` like
// the board: a subagent spawned for a task is working on it, a permission
// request from that agent means the task needs the person, and the end of
// its turn says how it went. The model's `set` still has the last word;
// these rules only move a task between the states the events can tell
// apart, and never touch one that is already merged or shipped.
import type { AgentLink, AgentLinks, WaveBoardPlan, WaveBoardTask } from '../types'
import { applyUpdates } from './board'

/** What `turn.complete` says about why a subagent's turn ended. */
export type EndReason = 'answer' | 'aborted' | 'refusal' | 'error'

/** A plan and its links after a rule ran, and whether anything moved. */
export type AutoResult = { plan: WaveBoardPlan; links: AgentLinks; changed: boolean }

// Work that is over: no event moves a task out of these.
const SETTLED = new Set(['🟩', '🚀'])

// A task nobody is on yet: a spawn for it makes it 🔧. A task already in
// review, testing or fixing keeps its icon when a second agent (a reviewer,
// say) is spawned for it; the link is kept all the same.
const FRESH = new Set(['🥚', '🥱', '👻', '🧟'])

// The states in which a task can be held up by a permission prompt.
const RUNNING = new Set(['🔧', '👀', '🩹', '🧪'])

// The states a finished turn hands over to review from: the agent was
// working, waiting for the person while working, or quiet long enough for
// the board to call the task stale.
const WORKING = new Set(['🔧', '🔑', '🧟'])

// A linked agent's tool calls keep its task from going stale, but writing
// the plan on every call would redraw the band for each one: a touch older
// than a minute is renewed, a newer one is left as it is.
const TOUCH_EVERY_MS = 60 * 1000

/**
 * The regular expression that finds a task id as a whole word, so `T1`
 * does not match inside `T12` and `rev` not inside `review`. Ids may
 * carry characters that mean something in a pattern (`CI/CD`), hence the
 * escape.
 */
function wordPattern(id: string): RegExp {
  const escaped = id.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`)
}

/** Every task id of the plan, longest first so `T12` wins over `T1`. */
function taskIds(plan: WaveBoardPlan): string[] {
  const ids = plan.waves.flatMap(wave => wave.tasks.map(task => task[0]))

  return ids.sort((a, b) => b.length - a.length)
}

/**
 * The task a spawn is for: the first id found as a whole word in any of
 * the texts (the Agent call's description, then its name), or null when
 * the spawn names none.
 *
 * @param plan the plan whose ids are looked for
 * @param texts the spawn's description and name, in that order
 */
export function taskOf(plan: WaveBoardPlan, ...texts: Array<string | undefined>): string | null {
  const ids = taskIds(plan)

  for (const text of texts) {
    if (text === undefined || text === '') {
      continue
    }

    const found = ids.find(id => wordPattern(id).test(text))

    if (found !== undefined) {
      return found
    }
  }

  return null
}

/** The task with that id, or undefined when the plan has none. */
function taskById(plan: WaveBoardPlan, id: string): WaveBoardTask | undefined {
  for (const wave of plan.waves) {
    const task = wave.tasks.find(candidate => candidate[0] === id)

    if (task !== undefined) {
      return task
    }
  }

  return undefined
}

/** The icon of a task, or undefined when the plan has no such id. */
export function iconOf(plan: WaveBoardPlan, id: string): string | undefined {
  return taskById(plan, id)?.[1]
}

/** The result of a rule that moved nothing. */
function unchanged(plan: WaveBoardPlan, links: AgentLinks): AutoResult {
  return { plan, links, changed: false }
}

/** The plan with one task's icon replaced, through the same path `set` uses. */
function withIcon(plan: WaveBoardPlan, id: string, icon: string, now: number): WaveBoardPlan {
  return applyUpdates(plan, { tasks: { [id]: icon } }, now).plan
}

/**
 * A subagent started. Finds its task by the spawn's words and links the
 * agent to it; the task becomes 🔧 when nobody was on it yet.
 *
 * @param spawn the agent's id and the words the Agent call gave it
 * @param now epoch milliseconds of the event
 */
export function onSpawn(
  plan: WaveBoardPlan,
  links: AgentLinks,
  spawn: { agentId: string; description?: string; name?: string },
  now: number,
): AutoResult {
  const task = taskOf(plan, spawn.description, spawn.name)

  if (task === null) {
    return unchanged(plan, links)
  }

  const link: AgentLink = { task, before: null }
  const linked = { ...links, [spawn.agentId]: link }
  const icon = iconOf(plan, task)

  if (icon === undefined || !FRESH.has(icon)) {
    return { plan, links: linked, changed: true }
  }

  return { plan: withIcon(plan, task, '🔧', now), links: linked, changed: true }
}

/**
 * A linked agent asked the person for a permission: its task needs them.
 * The icon it had is kept in the link, so the next tool call of the same
 * agent can give it back once the person has answered.
 */
export function onPermission(plan: WaveBoardPlan, links: AgentLinks, agentId: string, now: number): AutoResult {
  const link = links[agentId]

  if (link === undefined) {
    return unchanged(plan, links)
  }

  const icon = iconOf(plan, link.task)

  if (icon === undefined || !RUNNING.has(icon)) {
    return unchanged(plan, links)
  }

  const held = { ...links, [agentId]: { task: link.task, before: icon } }

  return { plan: withIcon(plan, link.task, '🔑', now), links: held, changed: true }
}

/**
 * A linked agent that calls a tool is still on its task: the task's touch
 * is renewed, so it does not go stale while the agent works. A touch less
 * than a minute old is left alone, and a task out of the running stages
 * (done, waiting, stale) is not the tool call's to change.
 */
function keepFresh(plan: WaveBoardPlan, links: AgentLinks, id: string, now: number): AutoResult {
  const task = taskById(plan, id)

  if (task === undefined || !RUNNING.has(task[1])) {
    return unchanged(plan, links)
  }

  const touchedAt = task[2]?.touchedAt

  if (touchedAt !== undefined && now - touchedAt < TOUCH_EVERY_MS) {
    return unchanged(plan, links)
  }

  return { plan: withIcon(plan, id, task[1], now), links, changed: true }
}

/**
 * A linked agent called a tool: whatever permission it waited for was
 * answered, so a task still marked 🔑 by `onPermission` takes back the icon
 * it had. A task the model moved meanwhile keeps the model's choice; the
 * held icon is dropped either way. With nothing held, the call only keeps
 * the task fresh.
 */
export function onToolStart(plan: WaveBoardPlan, links: AgentLinks, agentId: string, now: number): AutoResult {
  const link = links[agentId]

  if (link === undefined) {
    return unchanged(plan, links)
  }

  if (link.before === null) {
    return keepFresh(plan, links, link.task, now)
  }

  const released = { ...links, [agentId]: { task: link.task, before: null } }

  if (iconOf(plan, link.task) !== '🔑') {
    return { plan, links: released, changed: true }
  }

  return { plan: withIcon(plan, link.task, link.before, now), links: released, changed: true }
}

/**
 * A linked agent's turn ended. An answer hands a task that was being
 * worked on (or had gone quiet long enough to be stale) to review; an
 * error or a refusal breaks it and an interruption stops it, from any
 * state that is not settled. The link stays: a message can wake the same
 * agent later.
 */
export function onComplete(
  plan: WaveBoardPlan,
  links: AgentLinks,
  end: { agentId: string; reason: EndReason },
  now: number,
): AutoResult {
  const link = links[end.agentId]

  if (link === undefined) {
    return unchanged(plan, links)
  }

  const icon = iconOf(plan, link.task)

  if (icon === undefined || SETTLED.has(icon)) {
    return unchanged(plan, links)
  }

  if (end.reason === 'answer') {
    if (!WORKING.has(icon)) {
      return unchanged(plan, links)
    }

    return { plan: withIcon(plan, link.task, '👀', now), links, changed: true }
  }

  const outcome = end.reason === 'aborted' ? '🛑' : '💥'

  return { plan: withIcon(plan, link.task, outcome, now), links, changed: true }
}
