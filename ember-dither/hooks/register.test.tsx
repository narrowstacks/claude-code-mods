import { expect, test } from 'claude-code/testing'

import { buildScene } from './scene.js'
import { problems, SCENE_ID } from './register.js'

test('the palette paints on Desktop', () => {
  expect(problems.filter(line => line.startsWith("Desktop won't paint"))).toEqual([])
})

test('the scene fits the size limit and keeps its animation', () => {
  const svg = buildScene()
  expect(svg.length < 131072).toBe(true)
  // Motion is CSS on clip windows; surfaces strip SVG <animate>.
  expect(svg).not.toContain('<animate')
  expect(svg).toContain('@keyframes m0')
  expect(svg).toContain('prefers-reduced-motion')
})

test('sets the look and draws the backdrop on desktop only', async ($, on) => {
  let backdrop: unknown
  on('theme.set', (_, e) => {
    backdrop = e.backdrop
    return { value: { isDrawn: true } } as never
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(backdrop).toEqual(expect.objectContaining({ scene: SCENE_ID }))

  const props = { scene: SCENE_ID, plugin: 'ember-dither', glass: false } as never
  const ui = await $.ui.mount({ plugin: 'ember-dither', component: 'Backdrop', requestId: 'b', surface: 'desktop', props })
  expect(await ui.find({ type: 'Svg' })).toBeTruthy()
  await ui.unmount()
})
