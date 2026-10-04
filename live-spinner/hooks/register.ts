import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Running } from '../types'

const running = atom({ plugin: 'live-spinner', key: 'running' } as const, [] as Running[])

const MAX = 60

const clip = (text: string) => {
  const line = (text.split('\n')[0] ?? '').trim()

  return line.length > MAX ? `${line.slice(0, MAX - 1)}…` : line
}

const base = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path

const field = (input: object, key: string) => {
  const value = (input as Record<string, unknown>)[key]

  return typeof value === 'string' ? value : undefined
}

export const labelFor = (tool: string, input: object): string => {
  const path = field(input, 'file_path') ?? field(input, 'notebook_path')

  switch (tool) {
    case 'Bash':
      return `$ ${clip(field(input, 'command') ?? '')}`
    case 'Read':
      return `Reading ${base(path ?? '')}`
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return `Editing ${base(path ?? '')}`
    case 'Grep':
      return `Searching "${clip(field(input, 'pattern') ?? '')}"`
    case 'Glob':
      return `Finding ${clip(field(input, 'pattern') ?? '')}`
    case 'WebFetch': {
      const url = field(input, 'url') ?? ''
      const host = url.match(/^https?:\/\/([^/]+)/)?.[1]

      return `Fetching ${host ?? clip(url)}`
    }
    case 'WebSearch':
      return `Searching web: ${clip(field(input, 'query') ?? '')}`
    case 'Agent':
    case 'Task':
      return `Agent: ${clip(field(input, 'description') ?? 'working')}`
  }

  const mcp = tool.match(/^mcp__(.+?)__(.+)$/)
  if (mcp !== null) {
    return `${(mcp[1] ?? '').replace(/^claude_ai_|^plugin_/, '')}: ${mcp[2] ?? ''}`
  }

  return tool
}

export const register: Register = on => {
  on('tool.call', async ($, e, next) => {
    const call: Running = { id: e.tool_use_id, label: labelFor(e.tool, e) }
    await update($, running, list => [...list, call])

    try {
      return await next(e)
    } finally {
      await update($, running, list => list.filter(one => one.id !== call.id))
    }
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, running, () => [])
    }

    return next(e)
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const list = await read($, running)
    const latest = list.at(-1)

    if (latest === undefined || e.props.message !== null) {
      return next(e)
    }

    const more = list.length > 1 ? ` (+${list.length - 1})` : ''

    return next({ ...e, props: { ...e.props, message: `${latest.label}${more}` } })
  })
}
