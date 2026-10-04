import { expect, mock, test } from 'claude-code/testing'

const NOTE = '## Goal\nShip the mods'
const USAGE = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }
const run = (args: string) => ({ command: 'handoff', args, ...RUN })
const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' as const } })

test('save writes a note, and the first prompt after /clear carries it once', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.root', () => ({ value: '/repo' }) as never)
  on('model.fork', () => ({ value: { isAnswered: true, text: NOTE, usage: USAGE } }) as never)
  on('command.run', { command: 'clear' }, () => ({ text: '' }))
  const seen: (readonly string[] | undefined)[] = []
  on('prompt.submit', (_t, e) => {
    seen.push(e.context)

    return { text: e.text, context: e.context }
  })

  const saved = await $.command.run(run('save'))
  expect(saved.text).toContain('saved')
  expect((await $.command.run(run('show'))).text).toBe(NOTE)

  await $.command.run({ command: 'clear', args: '', ...RUN })
  await $.prompt.submit(typed('continue'))
  await $.prompt.submit(typed('and then'))

  expect(seen[0]?.join('\n') ?? '').toContain('Ship the mods')
  expect(seen[1]).toBe(undefined)
  expect((await $.command.run(run('show'))).text).toContain('No handoff note')
})

test('nothing to hand off before the first response', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.root', () => ({ value: '/repo' }) as never)
  on('model.fork', () => ({ value: { isAnswered: false, reason: 'nothing-to-fork' } }) as never)
  const ran = await $.command.run(run('save'))
  expect(ran.text).toContain('nothing to hand off')
})
