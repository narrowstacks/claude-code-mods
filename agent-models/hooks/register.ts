import { atom, update, read } from 'claude-code'
import type { PluginOptions, Register } from 'claude-code'

import type { Spawn } from '../types'

const recent = atom({ plugin: 'agent-models', key: 'recent' } as const, [] as Spawn[])

const INHERIT = 'inherit'
const MODELS = ['haiku', 'sonnet', 'opus', 'fable']
// Subagent types with their own row in /config, and that row's field.
const FIELDS: Record<string, string> = { Explore: 'explore', 'general-purpose': 'generalPurpose', Plan: 'plan' }

export const parseCustom = (text: string): Record<string, string> =>
  Object.fromEntries(
    text
      .split(',')
      .map(pair => pair.split('=').map(part => part.trim()))
      .filter((pair): pair is [string, string] => pair.length === 2 && pair[0] !== '' && pair[1] !== ''),
  )

const formatCustom = (rules: Record<string, string>) =>
  Object.entries(rules).map(([type, model]) => `${type}=${model}`).join(', ')

// The pinned model for a subagent type, or null to leave it alone.
export const pinFor = (type: string, options: PluginOptions): string | null => {
  const str = (key: string) => (typeof options[key] === 'string' ? (options[key] as string) : INHERIT)
  const custom = parseCustom(str('custom') === INHERIT ? '' : str('custom'))
  const field = FIELDS[type]
  const model = custom[type] ?? (field !== undefined ? str(field) : str('other'))

  return model === INHERIT || model === '' ? null : model
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agent-models',
      description: 'Show subagent model pins, or set one: /agent-models Explore haiku',
    })

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    if (e.fork) {
      return next(e)
    }

    const pinned = pinFor(e.subagentType, options)
    const keepCaller = e.model !== undefined && options.force !== true
    const model = pinned === null || keepCaller ? e.model : pinned
    const source: Spawn['source'] = model === undefined ? 'inherited' : model === e.model ? 'caller' : 'pinned'
    await update($, recent, list =>
      [...list, { type: e.subagentType, model: model ?? e.parentModel, source }].slice(-6),
    )

    return next(model === e.model ? e : { ...e, model })
  })

  on('command.run', { command: 'agent-models' }, async ($, e) => {
    const [type, model] = e.args.trim().split(/\s+/)

    if (type !== undefined && type !== '') {
      if (model === undefined || ![INHERIT, ...MODELS].includes(model)) {
        return { text: `Usage: /agent-models <type> <${[INHERIT, ...MODELS].join('|')}>` }
      }
      const field = FIELDS[type] ?? (type === 'other' ? 'other' : undefined)
      const custom = parseCustom(typeof options.custom === 'string' ? options.custom : '')
      if (field === undefined) {
        if (model === INHERIT) delete custom[type]
        else custom[type] = model
      }
      const set = field !== undefined
        ? await $.config.set({ key: `agent-models.${field}`, value: model })
        : await $.config.set({ key: 'agent-models.custom', value: formatCustom(custom) })

      return { text: 'deny' in set && set.deny !== undefined ? `Not saved: ${set.deny}` : `${type} subagents: ${model}.` }
    }

    const rows = [...Object.keys(FIELDS), ...Object.keys(parseCustom(typeof options.custom === 'string' ? options.custom : ''))]
      .map(name => `  ${name.padEnd(20)} ${pinFor(name, options) ?? INHERIT}`)
    const spawns = (await read($, recent)).map(s => `  ${s.type.padEnd(20)} ${s.model} (${s.source})`)

    return {
      text: [
        'Pins:',
        ...rows,
        `  ${'any other'.padEnd(20)} ${typeof options.other === 'string' ? options.other : INHERIT}`,
        options.force === true ? 'Explicit models are overridden.' : 'A model the caller names wins over a pin.',
        ...(spawns.length > 0 ? ['', 'Recent subagents:', ...spawns] : []),
        '',
        'Change with /agent-models <type> <model>, or in /config.',
      ].join('\n'),
    }
  })
}
