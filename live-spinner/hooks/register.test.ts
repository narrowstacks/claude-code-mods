import { expect, test } from 'claude-code/testing'

import { labelFor } from './register'

test('labels common tools', async () => {
  expect(labelFor('Bash', { command: 'bun test --watch\nmore' })).toBe('$ bun test --watch')
  expect(labelFor('Read', { file_path: '/a/b/register.ts' })).toBe('Reading register.ts')
  expect(labelFor('WebFetch', { url: 'https://docs.anthropic.com/x' })).toBe('Fetching docs.anthropic.com')
  expect(labelFor('mcp__claude_ai_Gmail__search_threads', {})).toBe('Gmail: search_threads')
})

test('spinner shows the running tool, then falls back', async ($, on) => {
  const props = { word: 'Baking', message: null, suffix: '…', mode: 'tool-use' as const }
  let during: unknown

  let shown: string | null = null
  on('ui.render', { component: 'Spinner' }, (t, e) => {
    shown = e.props.message ?? e.props.word
    const { Text } = t.ui.resolve(e)

    return h(Text, null, shown) as never
  })
  on('tool.call', async () => {
    await $.ui.render({ surface: 'terminal', component: 'Spinner', requestId: 'main', props })
    during = shown

    return { result: { stdout: '', stderr: '', interrupted: false } as never }
  })

  await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(during).toBe('$ git status')

  await $.ui.render({ surface: 'terminal', component: 'Spinner', requestId: 'main', props })
  expect(shown).toBe('Baking')
})
