export type Note = { text: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    handoff: { armed: boolean }
  }
}
