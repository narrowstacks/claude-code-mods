export type EditedFiles = string[]

declare module 'claude-code' {
  interface PluginState {
    'context-watch': { edited: EditedFiles; warned: number[]; tick: number }
  }
}
