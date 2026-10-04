import { expect, test } from 'claude-code/testing'

import { parseCustom, pinFor } from './register'

const DEFAULTS = { explore: 'haiku', generalPurpose: 'inherit', plan: 'inherit', other: 'inherit', custom: '', force: false }

test('resolves pins by type', async () => {
  expect(pinFor('Explore', DEFAULTS)).toBe('haiku')
  expect(pinFor('general-purpose', DEFAULTS)).toBe(null)
  expect(pinFor('code-reviewer', { ...DEFAULTS, other: 'sonnet' })).toBe('sonnet')
  expect(pinFor('code-reviewer', { ...DEFAULTS, custom: 'code-reviewer=opus' })).toBe('opus')
  expect(pinFor('Explore', { ...DEFAULTS, custom: 'Explore=sonnet' })).toBe('sonnet')
})

test('parses custom pairs', async () => {
  expect(parseCustom('a=haiku, b = opus ,bad,')).toEqual({ a: 'haiku', b: 'opus' })
})

const spawn = (subagentType: string, model?: string) =>
  ({ tool_use_id: 't', prompt: 'p', description: 'd', subagentType, model, parentModel: 'claude-fable-5-1', background: false, fork: false }) as never

test('pins a model when the caller gave none', async ($, on) => {
  let got: string | undefined
  on('agent.spawn', (_t, e) => {
    got = e.model

    return { model: e.model ?? e.parentModel }
  })
  await $.agent.spawn(spawn('Explore'))
  expect(got).toBe('haiku')

  await $.agent.spawn(spawn('Explore', 'opus'))
  expect(got).toBe('opus')

  await $.agent.spawn(spawn('general-purpose'))
  expect(got).toBe(undefined)
})

test('force overrides the caller', { options: { force: true } }, async ($, on) => {
  let got: string | undefined
  on('agent.spawn', (_t, e) => {
    got = e.model

    return { model: e.model ?? e.parentModel }
  })
  await $.agent.spawn(spawn('Explore', 'opus'))
  expect(got).toBe('haiku')
})
