export type Verdict = 'pending' | 'passing' | 'failing' | 'none'

export type TrackedPr = {
  url: string
  label: string
  title: string
  state: 'OPEN' | 'MERGED' | 'CLOSED' | 'UNKNOWN'
  verdict: Verdict
  passed: number
  failed: number
  pending: number
}

declare module 'claude-code' {
  interface PluginState {
    'pr-watch': { prs: TrackedPr[]; isHidden: boolean }
  }
}
