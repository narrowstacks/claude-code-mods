export type BuildResult = {
  kind: 'build' | 'test'
  ok: boolean
  at: number
  durationMs: number
  scheme?: string
  errors: number
  tests?: number
  failures?: number
}

declare module 'claude-code' {
  interface PluginState {
    'xcode-status': { project: string | null; last: BuildResult | null; simulator: string | null; tick: number }
  }
}
