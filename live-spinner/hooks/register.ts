import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Running } from '../types'

const running = atom({ plugin: 'live-spinner', key: 'running' } as const, [] as Running[])

// Room the engine keeps on the spinner line for the glyph, elapsed time and tokens.
const RESERVED = 34
const MIN_WIDTH = 20

const firstLine = (text: string) => (text.split('\n')[0] ?? '').trim()

const base = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path

const field = (input: object, key: string) => {
  const value = (input as Record<string, unknown>)[key]

  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

export const clip = (text: string, width: number) =>
  text.length > width ? `${text.slice(0, Math.max(1, width - 1))}…` : text

// Drops what says little about the work: leading cd's and env assignments,
// the parent folders of absolute paths, and everything after the first pipe.
export const shortenCommand = (command: string) => {
  let text = firstLine(command)
  text = text.replace(/^(\s*cd\s+("[^"]*"|'[^']*'|\S+)\s*(&&|;)\s*)+/, '')
  text = text.replace(/^(\s*[A-Z_][A-Z0-9_]*=("[^"]*"|'[^']*'|\S*)\s+)+/, '')
  text = text.replace(/(^|[\s='"])(?:~|\/[^\s'"]*)\/([^\s/'"]+)/g, '$1$2')

  const [head, ...rest] = text.split(/\s\|\s/)

  return `${(head ?? '').trim()}${rest.length > 0 ? ' | …' : ''}`
}

export const labelFor = (tool: string, input: object): Pick<Running, 'label' | 'detail'> => {
  const path = field(input, 'file_path') ?? field(input, 'notebook_path')

  switch (tool) {
    case 'Bash': {
      const command = shortenCommand(field(input, 'command') ?? '')
      const description = field(input, 'description')

      return description !== undefined
        ? { label: firstLine(description), detail: command }
        : { label: `$ ${command}` }
    }
    case 'Read':
      return { label: `Reading ${base(path ?? '')}` }
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return { label: `Editing ${base(path ?? '')}` }
    case 'Grep':
      return { label: `Searching "${firstLine(field(input, 'pattern') ?? '')}"` }
    case 'Glob':
      return { label: `Finding ${firstLine(field(input, 'pattern') ?? '')}` }
    case 'WebFetch': {
      const url = field(input, 'url') ?? ''

      return { label: `Fetching ${url.match(/^https?:\/\/([^/]+)/)?.[1] ?? url}` }
    }
    case 'WebSearch':
      return { label: `Searching web: ${firstLine(field(input, 'query') ?? '')}` }
    case 'Agent':
    case 'Task':
      return { label: `Agent: ${firstLine(field(input, 'description') ?? 'working')}` }
  }

  const mcp = tool.match(/^mcp__(.+?)__(.+)$/)
  if (mcp !== null) {
    return { label: `${(mcp[1] ?? '').replace(/^claude_ai_|^plugin_/, '')}: ${mcp[2] ?? ''}` }
  }

  return { label: tool }
}

// The label always shows; the detail joins it only when both fit whole.
export const spinnerText = (call: Pick<Running, 'label' | 'detail'>, more: number, width: number) => {
  const suffix = more > 0 ? ` (+${more})` : ''
  const room = Math.max(MIN_WIDTH, width - suffix.length)
  const full = call.detail !== undefined ? `${call.label} · ${call.detail}` : call.label
  const text = full.length <= room ? full : clip(call.label, room)

  return `${text}${suffix}`
}

export const register: Register = on => {
  on('tool.call', async ($, e, next) => {
    const call: Running = { id: e.tool_use_id, ...labelFor(e.tool, e) }
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

    const width = (e.viewport?.columns ?? 80) - RESERVED - e.props.word.length
    const message = spinnerText(latest, list.length - 1, width)

    return next({ ...e, props: { ...e.props, message } })
  })
}
