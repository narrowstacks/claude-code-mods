export type PrState = 'OPEN' | 'MERGED' | 'CLOSED'

export type WorktreeRow = {
  path: string
  name: string
  branch: string | null
  isMain: boolean
  isCurrent: boolean
  dirty: number
  ahead?: number
  behind?: number
  pr?: { number: number; state: PrState }
}

declare module 'claude-code' {
  interface PluginState {
    worktrees: { rows: WorktreeRow[]; isLoading: boolean; error: string | null }
  }
}
