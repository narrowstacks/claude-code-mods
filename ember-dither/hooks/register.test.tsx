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

const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }
const run = (args: string) => ({ command: 'ember-dither', args, ...RUN })

test('off until /ember-dither on, then sets the look and draws the backdrop', async ($, on) => {
  let backdrop: unknown
  let cleared = 0
  on('command.register', () => ({ value: { command: 'ember-dither' } }) as never)
  on('theme.set', (_, e) => {
    backdrop = e.backdrop
    return { value: { isDrawn: true } } as never
  })
  on('theme.clear', () => {
    cleared++
    return { value: undefined } as never
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(backdrop).toBe(undefined)

  expect((await $.command.run(run('on'))).text).toContain('on for this session')
  expect(backdrop).toEqual(expect.objectContaining({ scene: SCENE_ID }))

  const props = { scene: SCENE_ID, plugin: 'ember-dither', glass: false } as never
  const ui = await $.ui.mount({ plugin: 'ember-dither', component: 'Backdrop', requestId: 'b', surface: 'desktop', props })
  expect(await ui.find({ type: 'Svg' })).toBeTruthy()
  await ui.unmount()

  expect((await $.command.run(run(''))).text).toContain('is on')
  expect((await $.command.run(run('off'))).text).toContain('off for this session')
  expect(cleared).toBe(1)
  expect((await $.command.run(run('off'))).text).toContain('already off')
  expect(cleared).toBe(1)
})

test('a session that turned it on before a reload wears it again', async ($, on) => {
  let sets = 0
  on('state.get', () => ({ value: { value: true } }) as never)
  on('command.register', () => ({ value: { command: 'ember-dither' } }) as never)
  on('theme.set', () => {
    sets++
    return { value: { isDrawn: true } } as never
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(sets).toBe(1)
})
