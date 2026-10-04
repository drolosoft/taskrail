// The board itself: pure functions from a plan to the lines the band draws,
// kept free of `$` so the hooks module can import it and `claude plugin
// validate` still sees every call.
import type { WaveBoardMode, WaveBoardPlan, WaveBoardTask, WaveBoardWave } from '../types'

/** A run of text in a row, bold when the task is in flight. */
export type Segment = { text: string; bold?: boolean }

/** The four modes `/taskrail` accepts, in the order the usage line lists them. */
export const MODES: readonly WaveBoardMode[] = ['off', 'bar', 'full', 'both']

// Every emoji the board uses is two terminal cells wide; everything else
// (box drawing, Latin, digits) is one. Text glyphs never carry state.
const EMOJI = new Set([...'🥚🔧👀🩹🧪🟩🚀🔑👻🧟💥🥱🛑◾🟨🟥'])

// The order in which the header counts the icons: every icon the model
// may set, finished work first and pending last.
const ORDER = ['🟩', '🔧', '👀', '🩹', '🧪', '🚀', '🔑', '💥', '🛑', '👻', '🧟', '🥱', '🥚']

// A wave's station shows its most urgent state: a stop first, then the
// events, the running stages and a shipped task, in this order.
const URGENCY = ['🛑', '🔑', '💥', '🧟', '👻', '🩹', '👀', '🧪', '🔧', '🚀']

// The stages that count as "running" for the yellow tiles of the bar.
const RUNNING = new Set(['🔧', '👀', '🩹', '🧪'])

// Width of the rules when the band cannot tell its own width.
export const DEFAULT_WIDTH = 66

/**
 * Terminal cells a string occupies.
 * @param text plain text, no ANSI codes
 */
export function cells(text: string): number {
  let count = 0

  for (const char of text) {
    count += EMOJI.has(char) ? 2 : 1
  }

  return count
}

/**
 * A cell padded with spaces up to `width` terminal cells.
 * @param cell the cell's text
 * @param width the column width in cells, ten by default
 */
export function pad(cell: string, width = 10): string {
  return cell + ' '.repeat(Math.max(0, width - cells(cell)))
}

/**
 * A wave's station icon: green when every task is merged, else the most
 * urgent event or stage among its tasks, else pending.
 */
export function aggregate(icons: readonly string[]): string {
  if (icons.length > 0 && icons.every(icon => icon === '🟩')) {
    return '🟩'
  }

  for (const candidate of URGENCY) {
    if (icons.includes(candidate)) {
      return candidate
    }
  }

  return '🥚'
}

/** Every task icon of the plan, wave by wave. */
function allIcons(plan: WaveBoardPlan): string[] {
  return plan.waves.flatMap(wave => wave.tasks.map(task => task[1]))
}

/** Icons of one wave. */
function waveIcons(wave: WaveBoardWave): string[] {
  return wave.tasks.map(task => task[1])
}

/** Epoch milliseconds as `HH:MM` in the machine's own time zone. */
export function clock(ms: number): string {
  const date = new Date(ms)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')

  return `${hours}:${minutes}`
}

/**
 * Colour tiles at scale: one tile per `100 / scale` percent of the plan,
 * green merged, yellow running, red pending or blocked. Never one tile per
 * task.
 */
export function tiles(done: number, running: number, total: number, scale: number): string {
  const green = total > 0 ? Math.round((done / total) * scale) : 0
  // At least one yellow tile while anything runs, so the eye sees movement
  // even when the share rounds to zero.
  const yellow = running > 0 ? Math.max(1, Math.round((running / total) * scale)) : 0
  const red = Math.max(0, scale - green - yellow)

  return '🟩'.repeat(green) + '🟨'.repeat(yellow) + '🟥'.repeat(red)
}

/** The counts the header shows: `🟩 13 · 👀 1 · 🥚 2`, icons in ORDER. */
export function counts(plan: WaveBoardPlan): string {
  const icons = allIcons(plan)

  return ORDER.filter(icon => icons.includes(icon))
    .map(icon => `${icon} ${icons.filter(one => one === icon).length}`)
    .join(' · ')
}

/** Merged tasks, running tasks and the total, the three numbers every view needs. */
export function progress(plan: WaveBoardPlan): { done: number; running: number; total: number } {
  const icons = allIcons(plan)
  const done = icons.filter(icon => icon === '🟩').length
  const running = icons.filter(icon => RUNNING.has(icon)).length

  return { done, running, total: icons.length }
}

/**
 * The one-line summary a tool result prints and the header carries:
 * ` title · done of total · HH:MM · counts`.
 */
export function headerLine(plan: WaveBoardPlan): string {
  const { done, total } = progress(plan)

  return ` ${plan.title} · ${done} of ${total} · ${clock(plan.updatedAt)} · ${counts(plan)}`
}

/**
 * The rail: ` main ` then one ten-cell station per wave and the goal. The
 * rail glyph is `━` up to the last all-green station and `┄` after it.
 */
export function rail(plan: WaveBoardPlan): string {
  const greens = plan.waves
    .map((wave, index) => (aggregate(waveIcons(wave)) === '🟩' ? index : -1))
    .filter(index => index >= 0)
  const lastGreen = greens.length > 0 ? Math.max(...greens) : -1
  let line = ' main '

  plan.waves.forEach((wave, index) => {
    const icons = waveIcons(wave)
    const glyph = index <= lastGreen ? '━' : '┄'
    const merged = icons.filter(icon => icon === '🟩').length
    line += pad(`${aggregate(icons)} ${wave.name} ${merged}/${icons.length} `, 9) + glyph
  })

  return line + `▶ 🚀 ${plan.goal}`
}

/**
 * The task rows under the rail: each wave hangs its tasks under its
 * station, `├` on every row but the last, `╰` on the last, ten cells per
 * column. Empty slots stay blank: a little drift reads better than filler
 * squares. Ids of tasks in flight go bold.
 */
export function taskRows(plan: WaveBoardPlan): Segment[][] {
  const depth = Math.max(0, ...plan.waves.map(wave => wave.tasks.length))
  const rows: Segment[][] = []

  for (let row = 0; row < depth; row += 1) {
    const filled = plan.waves.map((wave, index) => (row < wave.tasks.length ? index : -1))
    const last = Math.max(...filled)
    const segments: Segment[] = [{ text: '      ' }]

    plan.waves.slice(0, last + 1).forEach(wave => {
      const task = wave.tasks[row]

      if (task === undefined) {
        segments.push({ text: pad('') })
        return
      }

      const glyph = row === wave.tasks.length - 1 ? '╰' : '├'
      const [id, icon] = task
      const head = `${glyph}${icon} `
      const tail = ' '.repeat(Math.max(0, 10 - cells(head) - cells(id)))

      segments.push({ text: head })
      segments.push({ text: id, bold: icon !== '🟩' && icon !== '🥚' })
      segments.push({ text: tail })
    })

    rows.push(trimRow(segments))
  }

  return rows
}

/** Drops the trailing spaces of a row, segment by segment. */
function trimRow(segments: Segment[]): Segment[] {
  const trimmed = [...segments]

  while (trimmed.length > 0) {
    const lastSegment = trimmed[trimmed.length - 1]

    if (lastSegment === undefined || lastSegment.text.trim() !== '') {
      break
    }

    trimmed.pop()
  }

  const lastSegment = trimmed[trimmed.length - 1]

  if (lastSegment !== undefined) {
    trimmed[trimmed.length - 1] = { ...lastSegment, text: lastSegment.text.replace(/\s+$/, '') }
  }

  return trimmed
}

/**
 * Greedy word wrap at `width` cells.
 * @returns the lines, none when the text is empty
 */
export function wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(word => word !== '')
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`

    if (cells(candidate) <= width || current === '') {
      current = candidate
      continue
    }

    lines.push(current)
    current = word
  }

  if (current !== '') {
    lines.push(current)
  }

  return lines
}

/**
 * The boxed board: header, description, rail and rows, note and a
 * thirty-tile bar. No right border, because rows carry different emoji
 * counts and a right edge would zigzag.
 * @param width cells of the rules; the band's `bodyColumns` less two
 */
export function renderFull(plan: WaveBoardPlan, width = DEFAULT_WIDTH): Segment[][] {
  const { done, running, total } = progress(plan)
  const rule = '─'.repeat(width)
  const lines: Segment[][] = []

  lines.push([{ text: `╭${rule}` }])
  lines.push([
    { text: '│ ' },
    { text: plan.title, bold: true },
    { text: ` · ${done} of ${total} · ${clock(plan.updatedAt)} · ${counts(plan)}` },
  ])

  // The plan's description, written once and shown under the title on at
  // most two lines, behind a rule of its own.
  const description = wrapText(plan.description, width - 4).slice(0, 2)

  if (description.length > 0) {
    lines.push([{ text: `├${rule}` }])
    description.forEach(line => lines.push([{ text: `│ ${line}` }]))
  }

  lines.push([{ text: `├${rule}` }])
  lines.push([{ text: `│${rail(plan)}` }])
  taskRows(plan).forEach(row => lines.push([{ text: '│' }, ...row]))
  lines.push([{ text: `├${rule}` }])
  lines.push([{ text: `│ ${plan.note}` }])
  lines.push([{ text: `│ ${tiles(done, running, total, 30)} ${done}/${total}` }])
  lines.push([{ text: `╰${rule}` }])

  return lines
}

/**
 * The one-line rail for mode `bar`: project, title, time, one station per
 * wave, the goal and ten tiles.
 */
export function renderBar(plan: WaveBoardPlan): string {
  const { done, running, total } = progress(plan)
  const stations = plan.waves
    .map(wave => {
      const icons = waveIcons(wave)
      const merged = icons.filter(icon => icon === '🟩').length
      return `${wave.name} ${aggregate(icons)} ${merged}/${icons.length}`
    })
    .join(' ┄ ')

  return ` ${plan.project} · ${plan.title} · ${clock(plan.updatedAt)} · ${stations} ▶ 🚀 ${plan.goal} · ${tiles(done, running, total, 10)} ${done}/${total}`
}

/** The whole board as plain text, for the chat when the mode asks for it. */
export function renderText(plan: WaveBoardPlan, width = DEFAULT_WIDTH): string {
  return renderFull(plan, width)
    .map(row => row.map(segment => segment.text).join(''))
    .join('\n')
}

/** What the `plan` tool receives: the plan's words and its waves with task ids. */
export type PlanInput = {
  project: string
  title: string
  goal: string
  description?: string
  note?: string
  waves: { name: string; tasks: string[] }[]
}

/**
 * A fresh plan from the tool's input: every task starts pending.
 * @param now epoch milliseconds of the write
 */
export function newPlan(input: PlanInput, now: number): WaveBoardPlan {
  const waves = input.waves.map(wave => ({
    name: wave.name,
    tasks: wave.tasks.map((id): WaveBoardTask => [id, '🥚']),
  }))

  return {
    project: input.project,
    title: input.title,
    goal: input.goal,
    description: input.description ?? '',
    note: input.note ?? '',
    waves,
    updatedAt: now,
  }
}

/** What the `set` tool receives: icons per task id and the optional text fields. */
export type SetInput = {
  tasks?: Record<string, string>
  note?: string
  goal?: string
  title?: string
  description?: string
}

/**
 * The plan after the updates: a new object, the old one untouched.
 * @returns the plan and the task ids the input named but the plan lacks
 */
export function applyUpdates(plan: WaveBoardPlan, input: SetInput, now: number): { plan: WaveBoardPlan; unknown: string[] } {
  const tasks = input.tasks ?? {}
  const seen = new Set<string>()
  const waves = plan.waves.map(wave => ({
    name: wave.name,
    tasks: wave.tasks.map((task): WaveBoardTask => {
      const icon = tasks[task[0]]

      if (icon === undefined) {
        return [task[0], task[1]]
      }

      seen.add(task[0])
      return [task[0], icon]
    }),
  }))
  const unknown = Object.keys(tasks).filter(id => !seen.has(id))

  return {
    plan: {
      ...plan,
      waves,
      note: input.note ?? plan.note,
      goal: input.goal ?? plan.goal,
      title: input.title ?? plan.title,
      description: input.description ?? plan.description,
      updatedAt: now,
    },
    unknown,
  }
}

/**
 * The line the tools append for the model: what the current mode asks of
 * the chat, so the model never has to read a settings file.
 */
export function modeHint(mode: WaveBoardMode): string {
  switch (mode) {
    case 'off':
      return 'mode off: the board is not drawn above the prompt; show it in the chat only when the user asks (mcp__taskrail__show).'
    case 'bar':
      return 'mode bar: the one-line rail is already above the prompt; do not draw the board in the chat.'
    case 'full':
      return 'mode full: the board is already above the prompt; do not draw it in the chat.'
    case 'both':
      return 'mode both: the board is above the prompt AND is drawn in the chat at every milestone and close (mcp__taskrail__show).'
  }
}

/** True when `value` is one of the four modes. */
export function isMode(value: unknown): value is WaveBoardMode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value)
}
