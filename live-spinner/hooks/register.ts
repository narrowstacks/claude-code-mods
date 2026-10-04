import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Running } from '../types'

const running = atom({ plugin: 'live-spinner', key: 'running' } as const, [] as Running[])
const tick = atom({ plugin: 'live-spinner', key: 'tick' } as const, 0)

// A tool's own elapsed time joins its label once it has run this long.
const SHOW_ELAPSED_MS = 15_000

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

// `ssh [options] host command`: the host and what it runs there.
export const remoteOf = (command: string): { host: string; remote: string } | null => {
  const match = command.match(/^ssh\s+((?:-[a-zA-Z]+(?:\s+(?!-)\S+)?\s+)*)([^\s-]\S*)\s*(.*)$/)
  if (match === null) {
    return null
  }

  const host = (match[2] ?? '').replace(/^.*@/, '')
  const remote = (match[3] ?? '').trim().replace(/^(['"])([\s\S]*)\1$/, '$2')

  return { host, remote: remote === '' ? 'shell' : remote }
}

export const formatElapsed = (ms: number) => {
  const seconds = Math.floor(ms / 1000)

  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

export const labelFor = (tool: string, input: object): Pick<Running, 'label' | 'detail'> => {
  const path = field(input, 'file_path') ?? field(input, 'notebook_path')

  switch (tool) {
    case 'Bash': {
      const command = shortenCommand(field(input, 'command') ?? '')
      const description = field(input, 'description')
      const ssh = remoteOf(command)

      if (description !== undefined) {
        const label = firstLine(description)
        if (ssh === null) {
          return { label, detail: command }
        }

        return label.includes(ssh.host) ? { label } : { label, detail: `on ${ssh.host}` }
      }

      return ssh !== null ? { label: `${ssh.host} › ${ssh.remote}` } : { label: `$ ${command}` }
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

// The label always shows; the elapsed time and the detail join it, in that
// order, only when they fit whole.
export const spinnerText = (call: Pick<Running, 'label' | 'detail'>, more: number, width: number, elapsedMs = 0) => {
  const time = elapsedMs >= SHOW_ELAPSED_MS ? ` · ${formatElapsed(elapsedMs)}` : ''
  const suffix = `${time}${more > 0 ? ` (+${more})` : ''}`
  const room = Math.max(MIN_WIDTH, width - suffix.length)
  const full = call.detail !== undefined ? `${call.label} · ${call.detail}` : call.label
  const text = full.length <= room ? full : clip(call.label, room)

  return `${text}${suffix}`
}

export const register: Register = on => {
  // Redraws the spinner each second while a tool has run long enough to show its time.
  on('session.start', async ($, e, next) => {
    $.clock.every(1000, async () => {
      const list = await read($, running)
      const now = await $.clock.now()
      if (list.some(call => now - call.startedAt >= SHOW_ELAPSED_MS)) {
        await update($, tick, n => n + 1)
      }
    })

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const call: Running = { id: e.tool_use_id, ...labelFor(e.tool, e), startedAt: await $.clock.now() }
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
    await read($, tick)
    const list = await read($, running)
    const latest = list.at(-1)

    if (latest === undefined || e.props.message !== null) {
      return next(e)
    }

    const width = (e.viewport?.columns ?? 80) - RESERVED - e.props.word.length
    const message = spinnerText(latest, list.length - 1, width, (await $.clock.now()) - latest.startedAt)

    return next({ ...e, props: { ...e.props, message } })
  })
}
