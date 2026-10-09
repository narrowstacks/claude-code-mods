export type Verdict = 'pending' | 'passing' | 'failing' | 'none'

export type TrackedPr = {
  url: string
  title: string
  state: 'OPEN' | 'MERGED' | 'CLOSED' | 'UNKNOWN'
  verdict: Verdict
  passed: number
  failed: number
  pending: number
  /** Names of the failing checks; absent on PRs tracked before 0.2.0. */
  failing?: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'pr-watch': { prs: TrackedPr[]; isHidden: boolean }
  }
}
