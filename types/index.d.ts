/**
 * What the band shows: nothing, the one-line rail, the whole board, or the
 * whole board here and also in the chat at every milestone (the model's
 * side of `both`; the mod only tells it the mode).
 */
export type WaveBoardMode = 'off' | 'bar' | 'full' | 'both'

/**
 * When a task moved, in epoch milliseconds. `touchedAt` is the last time
 * `set` or an agent event wrote its icon (the same icon included);
 * `startedAt` the moment it first left 🥚, and `doneAt` the moment it
 * reached 🟩 or 🚀, null while it has not.
 */
export type TaskTimes = { touchedAt: number; startedAt: number | null; doneAt: number | null }

/**
 * One task of the plan: its id as it appears in the map, its state icon
 * and, once its icon was first written, its times. A tuple: compact in the
 * store and cheap to compare. Plans stored before the times existed carry
 * the first two alone.
 */
export type WaveBoardTask = [id: string, icon: string, times?: TaskTimes]

/** One wave: the tasks that run in parallel under one station of the rail. */
export type WaveBoardWave = { name: string; tasks: WaveBoardTask[] }

/** The plan of one session. */
export type WaveBoardPlan = {
  project: string
  title: string
  goal: string
  description: string
  note: string
  waves: WaveBoardWave[]
  /** Epoch milliseconds of the last write, shown as HH:MM in the header. */
  updatedAt: number
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
 * A subagent the engine reported, tied to the task its spawn named.
 * `before` is the icon the task had when the agent asked for a permission,
 * to give back once the person has answered; null while nothing is held.
 */
export type AgentLink = { task: string; before: string | null }

/** The links of this session, by agent id. Agents do not outlive a session, so neither do these. */
export type AgentLinks = Record<string, AgentLink>

/** What the `set` tool receives: icons per task id and the optional text fields. */
export type SetInput = {
  tasks?: Record<string, string>
  note?: string
  goal?: string
  title?: string
  description?: string
}

declare module 'claude-code' {
  // The mod's own tools, by the name the engine gives them. The type layer
  // the engine lays only knows the MCP servers a session had connected, so
  // without these entries `tool.call` and the tests reject the three names.
  interface McpToolInputs {
    'mcp__taskrail__plan': PlanInput
    'mcp__taskrail__set': SetInput
    'mcp__taskrail__show': {}
  }

  interface PluginState {
    'taskrail': {
      plan: WaveBoardPlan | null
      mode: WaveBoardMode
      agents: AgentLinks
    }
  }
}
