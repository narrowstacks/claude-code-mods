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

test('the band draws an Svg gauge on desktop and glyphs on terminal', async ($, on) => {
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 117000, window: 1000000, percent: 12 }, rateLimits: [{ kind: 'five_hour', percentUsed: 64 }], cost: { usd: 1.13 } },
  }) as never)
  on('ui.render', { component: 'AbovePrompt' }, (t, e) => {
    const { Box } = t.ui.resolve(e)

    return h(Box, null) as never
  })
  const props = { hasSurvey: false, isWorking: false, maxRows: 10 } as never

  const desktop = await $.ui.mount({ plugin: 'context-watch', surface: 'desktop', component: 'AbovePrompt', props })
  expect(await desktop.findAll({ type: 'Svg' })).toHaveLength(2)
  expect((await desktop.findAll({ type: 'Text', text: '117k / 1M' })).length).toBe(1)
  expect((await desktop.findAll({ type: 'Text', text: /\$1\.13/ })).length).toBe(1)

  const terminal = await $.ui.mount({ plugin: 'context-watch', surface: 'terminal', component: 'AbovePrompt', props })
  expect((await terminal.findAll({ type: 'Text', text: /▰/ })).length).toBe(1)
})

test('the desktop pane draws the breakdown as a stacked bar with a legend', async ($, on) => {
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: {
        tokens: 60000, window: 200000, percent: 30,
        breakdown: {
          rawMaxTokens: 200000, totalTokens: 60000, percentage: 30,
          categories: [
            { name: 'System prompt', tokens: 20000, kind: 'used', color: 'x', isDeferred: false },
            { name: 'Messages', tokens: 40000, kind: 'used', color: 'x', isDeferred: false },
            { name: 'Autocompact buffer', tokens: 30000, kind: 'buffer', color: 'x', isDeferred: false },
            { name: 'Free space', tokens: 110000, kind: 'free', color: 'x', isDeferred: false },
          ],
          mcpTools: [
            { name: 'mcp__gh__search', serverName: 'gh', tokens: 3000, isLoaded: true },
            { name: 'mcp__gh__view', serverName: 'gh', tokens: 1000, isLoaded: true },
            { name: 'mcp__vercel__deploy', serverName: 'vercel', tokens: 9000, isLoaded: false },
          ],
          memoryFiles: [],
        },
      },
      rateLimits: [],
    },
  }) as never)
  const ui = await $.ui.mount({ plugin: 'context-watch', surface: 'desktop', component: 'Pane', requestId: 'context-watch', props: {} as never })
  const svgs = await ui.findAll({ type: 'Svg' })
  // The stacked bar, a swatch for each of the three segments, one MCP server bar.
  expect(svgs).toHaveLength(5)
  // An Svg with an empty alt draws nothing on desktop.
  expect(svgs.every(svg => (svg.props as { alt?: string }).alt !== '')).toBe(true)
  expect(await ui.findAll({ type: 'Text', text: '4k · 2 tools' })).toHaveLength(1)
  expect(await ui.findAll({ type: 'Text', text: /1 more tool load on demand/ })).toHaveLength(1)
  expect(await ui.findAll({ type: 'Text', text: 'Messages' })).toHaveLength(1)
  expect(await ui.findAll({ type: 'Text', text: '40k · 20.0%' })).toHaveLength(1)
  expect(await ui.findAll({ type: 'Text', text: 'Free space' })).toHaveLength(0)
})
