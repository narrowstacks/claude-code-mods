import { expect, mock, test } from 'claude-code/testing'

import { activityOf, formatElapsed, parseNotification, trim } from './register'
import type { Job } from '../types'

const job = (id: string, status: Job['status'], endedAt?: number): Job => ({
  id, kind: 'shell', label: id, startedAt: 0, endedAt, status, isBackground: true, stopId: id,
})

test('formats elapsed time', async () => {
  expect(formatElapsed(12_000)).toBe('12s')
  expect(formatElapsed(100_000)).toBe('1m 40s')
  expect(formatElapsed(3_900_000)).toBe('1h 5m')
})

test('keeps running jobs and the newest five finished', async () => {
  const list = [job('run', 'running'), ...[1, 2, 3, 4, 5, 6, 7].map(n => job(`f${n}`, 'completed', n))]
  expect(trim(list).map(one => one.id)).toEqual(['run', 'f3', 'f4', 'f5', 'f6', 'f7'])
})

test('reads task notifications', async () => {
  expect(parseNotification('<task-notification><task-id>b2zc</task-id><status>failed</status></task-notification>'))
    .toEqual({ id: 'b2zc', status: 'failed' })
  expect(parseNotification('hello')).toBe(undefined)
})

test('tracks a background shell and draws it in the pane', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg1' } as never }))
  await $.tool.call({ tool: 'Bash', command: 'bun test --watch', description: 'Watch tests', run_in_background: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agent-jobs', surface, component: 'Pane', requestId: 'agent-jobs', props: {} as never })
    expect((await ui.findAll({ type: 'Text', text: /Watch tests/ })).length).toBe(1)
    expect((await ui.findAll({ type: 'Button', key: 'stop-bg1' })).length).toBe(1)
  }
})

test('a task notification finishes the shell', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg2' } as never }))
  on('prompt.submit', (_t, e) => ({ text: e.text }))
  await $.tool.call({ tool: 'Bash', command: 'make build', run_in_background: true })
  await $.prompt.submit({ text: '<task-notification><task-id>bg2</task-id><status>completed</status></task-notification>', origin: { kind: 'task-notification' } } as never)

  const ui = await $.ui.mount({ plugin: 'agent-jobs', surface: 'terminal', component: 'Pane', requestId: 'agent-jobs', props: {} as never })
  expect((await ui.findAll({ type: 'Text', text: /✓ make build/ })).length).toBe(1)
  expect((await ui.findAll({ type: 'Button' })).map(b => b.key)).toEqual(['clear'])

  await $.ui.press({ plugin: 'agent-jobs', key: 'clear' })
  expect((await ui.findAll({ type: 'Text', text: /Nothing running/ })).length).toBe(1)
})

test('labels what an agent is doing', async () => {
  expect(activityOf('Read', { file_path: '/a/b/register.ts' })).toBe('Reading register.ts')
  expect(activityOf('Bash', { command: 'bun test', description: 'Run tests' })).toBe('Run tests')
  expect(activityOf('mcp__claude_ai_Gmail__search_threads', {})).toBe('Gmail: search_threads')
})
