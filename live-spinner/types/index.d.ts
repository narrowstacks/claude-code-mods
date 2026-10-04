export type Running = { id: string; label: string; detail?: string; startedAt: number; isSigning?: boolean }

declare module 'claude-code' {
  interface PluginState {
    'live-spinner': { running: Running[]; tick: number }
  }
}
