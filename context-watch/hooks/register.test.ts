import { expect, test } from 'claude-code/testing'

import { statusText } from './register'

test('status line shows fill, cost and only hot rate limits', async () => {
  const text = statusText({
    startedAt: 0,
    context: { tokens: 164000, window: 200000, percent: 82 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 71.5 },
      { kind: 'seven_day', percentUsed: 12 },
    ],
    cost: { usd: 3.456 },
  })
  expect(text).toBe('ctx ▰▰▰▰▰▰▰▰▱▱ 82% 164k/200k  ·  $3.46  ·  5h 72%')
})

test('compaction is told to keep edited files', async ($, on) => {
  let told = ''
  on('tool.call', () => ({ result: { filePath: '/repo/src/app.ts' } as never }))
  on('session.compact', (_$, e) => {
    told = e.instructions ?? ''

    return { skip: 'test' }
  })

  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/app.ts', old_string: 'a', new_string: 'b' })
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] as never })
  expect(told).toContain('/repo/src/app.ts')
})

test('draws the pane on terminal and desktop', async ($) => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'context-watch', surface, component: 'Pane', requestId: 'context-watch', props: {} as never })
    expect((await ui.findAll({ type: 'Button', key: 'close' })).length).toBe(1)
  }
})

test('the band passes through what is beneath when figures are missing', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, (t, e) => {
    const { Text } = t.ui.resolve(e)

    return h(Text, null, 'beneath') as never
  })
  const ui = await $.ui.mount({ plugin: 'context-watch', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10 } as never })
  expect((await ui.findAll({ type: 'Text', text: 'beneath' })).length).toBe(1)
})
