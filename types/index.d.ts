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

declare module 'claude-code' {
  interface PluginState {
    'taskrail': {
      plan: WaveBoardPlan | null
      mode: WaveBoardMode
    }
  }
}
