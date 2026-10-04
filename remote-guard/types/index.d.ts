export type AllowedHosts = string[]

declare module 'claude-code' {
  interface PluginState {
    'remote-guard': { allowedHosts: AllowedHosts }
  }
}
