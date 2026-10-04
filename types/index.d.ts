/**
 * What the band shows: nothing, the one-line rail, the whole board, or the
 * whole board here and also in the chat at every milestone (the model's
 * side of `both`; the mod only tells it the mode).
 */
export type WaveBoardMode = 'off' | 'bar' | 'full' | 'both'

/**
 * One task of the plan: its id as it appears in the map and its state icon.
 * A tuple: compact in the store and cheap to compare.
 */
export type WaveBoardTask = [id: string, icon: string]

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
    }
  }
}
