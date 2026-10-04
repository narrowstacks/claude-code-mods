export type Spawn = { type: string; model: string; source: 'pinned' | 'caller' | 'inherited' }

declare module 'claude-code' {
  interface PluginState {
    'agent-models': { recent: Spawn[] }
  }
}
