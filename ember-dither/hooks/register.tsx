import type { Register, ThemeSetArgs } from 'claude-code'

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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))
    if (unpainted !== undefined) {
      $.ui.toast(unpainted)
    }
    await $.theme.set(LOOK)
    return next(e)
  })

  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    if ((e.surface !== 'desktop' && e.surface !== 'mobile') || e.props.scene !== SCENE_ID) {
      return next(e)
    }
    const { Svg } = $.ui.resolve(e)
    return <Svg source={SCENE} alt="A dark dithered gradient of purple, red and orange, slowly drifting" isInteractive />
  })
}
