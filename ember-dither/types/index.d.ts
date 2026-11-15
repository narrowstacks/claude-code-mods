/** Whether this session wears the Ember dither theme. */
export type IsOn = boolean

declare module 'claude-code' {
  interface PluginState {
    'ember-dither': { isOn: IsOn }
  }
}
