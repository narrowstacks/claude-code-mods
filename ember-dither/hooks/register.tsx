import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'
import { buildScene } from './scene.js'

const SCENE = buildScene()

// The scene's name changes with its drawing, so a surface that keeps a drawn
// scene by name draws the new one after an update.
const hash = (text: string) => {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0
  return h.toString(36)
}
export const SCENE_ID = `ember-dither-${hash(SCENE)}`

export const { theme, problems } = makeColors({
  label: 'Ember dither',
  only: 'dark',
  roles: { accent: '#e07a3c', danger: '#e2504c', success: '#7fb05c', warning: '#e5a83e', pro: '#b386e8' },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#130b17',
        'surface-1': '#1a0f1f',
        'surface-2': '#211426',
        'surface-3': '#28182c',
        'text-primary': '#f4e8ef',
        'text-secondary': '#d6c2d0',
        'text-muted': '#ad97a6',
      },
    },
  },
})

const LOOK: ThemeSetArgs = {
  colors: theme,
  backdrop: { scene: SCENE_ID, glass: { blur: 3, tint: '#120a15', opacity: 0.72 } },
}

// Whether this session wears the theme. Off until /ember-dither on; it outlives a
// reload, so a reloaded or resumed session keeps its choice.
const isOn = atom({ plugin: 'ember-dither', key: 'isOn' } as const, false)

const USAGE = 'Usage: /ember-dither on | off'

const wear = async ($: EngineInterface): Promise<string> => {
  const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))
  if (unpainted !== undefined) {
    return unpainted
  }
  const set = await $.theme.set(LOOK)
  return set.isDrawn ? 'Ember dither is on for this session.' : `Ember dither is on, but nothing draws it here: ${set.reason}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ember-dither',
      description: 'Turn the Ember dither theme on or off for this session. Args: on | off',
    })
    if (await read($, isOn)) {
      await wear($)
    }
    return next(e)
  })

  on('command.run', { command: 'ember-dither' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on') {
      await update($, isOn, () => true)
      return { text: await wear($) }
    }
    if (arg === 'off') {
      if (!(await read($, isOn))) {
        return { text: 'Ember dither is already off for this session.' }
      }
      await update($, isOn, () => false)
      await $.theme.clear()
      return { text: 'Ember dither is off for this session.' }
    }
    const state = (await read($, isOn)) ? 'on' : 'off'
    return { text: `Ember dither is ${state} for this session. ${USAGE}` }
  })

  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    if ((e.surface !== 'desktop' && e.surface !== 'mobile') || e.props.scene !== SCENE_ID) {
      return next(e)
    }
    const { Svg } = $.ui.resolve(e)
    return <Svg source={SCENE} alt="A dark dithered gradient of purple, red and orange, slowly drifting" isInteractive />
  })
}
