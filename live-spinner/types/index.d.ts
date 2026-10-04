export type Running = { id: string; label: string }

declare module 'claude-code' {
  interface PluginState {
    'live-spinner': { running: Running[] }
  }
}
