import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

const edited = atom({ plugin: 'context-watch', key: 'edited' } as const, [])
const warned = atom({ plugin: 'context-watch', key: 'warned' } as const, [])
const tick = atom({ plugin: 'context-watch', key: 'tick' } as const, 0)

const PANE = 'context-watch'
const THRESHOLDS = [60, 80, 90]
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])
const PALETTE = ['cyan', 'magenta', 'blue', 'yellow', 'green', 'red', 'white']

const shortPath = (path: string) => path.split('/').slice(-2).join('/')

const formatK = (tokens: number) =>
  tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens)

export const bar = (fraction: number, width: number, full = '▰', empty = '▱') => {
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * width)

  return full.repeat(filled) + empty.repeat(width - filled)
}

const heat = (percent: number) => (percent >= 80 ? 'red' : percent >= 60 ? 'yellow' : 'green')

const limitName = (kind: string) =>
  kind === 'five_hour' ? '5h' : kind === 'seven_day' ? '7d' : kind

export const statusText = (usage: SessionUsage) => {
  const parts: string[] = []
  const { percent, tokens, window } = usage.context

  if (percent !== undefined) {
    parts.push(`ctx ${bar(percent / 100, 10)} ${percent}% ${formatK(tokens ?? 0)}/${formatK(window)}`)
  }
  if (usage.cost !== undefined) {
    parts.push(`$${usage.cost.usd.toFixed(2)}`)
  }
  for (const limit of usage.rateLimits) {
    if (limit.percentUsed >= 50) {
      parts.push(`${limitName(limit.kind)} ${Math.round(limit.percentUsed)}%`)
    }
  }

  return parts.join('  ·  ')
}

const refresh = async ($: EngineInterface) => {
  const usage = await $.session.usage()
  $.ui.status(statusText(usage) || undefined)
  await update($, tick, n => n + 1)

  const percent = usage.context.percent
  if (percent === undefined) {
    return
  }

  const already = await read($, warned)
  const crossed = THRESHOLDS.filter(t => percent >= t && !already.includes(t))
  if (crossed.length === 0) {
    return
  }

  await update($, warned, list => [...list, ...crossed])
  const top = Math.max(...crossed)
  const hint = top >= 80 ? ' Consider /compact with a focus, or /clear for a new task.' : ''
  $.ui.toast(`Context at ${percent}%.${hint}`, { timeoutMs: 8000 })
}

// Best effort from places that must not wait on it: a failed read only skips one refresh.
const refreshLater = ($: EngineInterface) => {
  refresh($).catch(() => undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ctx',
      description: 'Context window pane: what is using tokens',
    })
    refreshLater($)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (EDIT_TOOLS.has(e.tool) && 'file_path' in e && typeof e.file_path === 'string' && !ran.isError) {
      const path = e.file_path
      await update($, edited, list => [...list.filter(p => p !== path), path].slice(-50))
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      await refresh($)
    }

    return done
  })

  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }

    const files = await read($, edited)
    const keep = [
      'Preserve verbatim: every explicit instruction or constraint the user gave, open TODOs, and the current next step.',
      files.length > 0 ? `Files edited this session (keep this list): ${files.join(', ')}` : '',
    ].filter(Boolean)
    const instructions = [e.instructions, ...keep].filter(Boolean).join('\n')
    const result = await next({ ...e, instructions })

    await update($, warned, () => [])
    refreshLater($)

    return result
  })

  on('command.run', { command: 'ctx' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Context' })
    await update($, tick, n => n + 1)

    return { text: 'Context pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    await read($, tick)

    const usage = await $.session.usage({ breakdown: 'summary' }).catch(() => undefined)
    if (usage === undefined) {
      return (
        <Box flexDirection="column">
          <Text dimColor>Context figures are not available yet.</Text>
          <Button key="close" label="Close" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
      )
    }

    const files = await read($, edited)
    const breakdown = usage.context.breakdown
    const percent = usage.context.percent ?? breakdown?.percentage ?? 0
    const columns = e.viewport?.columns ?? 80
    const gaugeWidth = Math.max(10, Math.min(40, columns - 24))
    const rowWidth = Math.max(8, Math.min(30, columns - 40))
    const total = breakdown?.rawMaxTokens ?? usage.context.window

    const used = (breakdown?.categories ?? [])
      .filter(c => c.kind === 'used' && c.tokens > 0)
      .sort((a, b) => b.tokens - a.tokens)
    const mcp = [...(breakdown?.mcpTools ?? [])].sort((a, b) => b.tokens - a.tokens).slice(0, 4)
    const memory = [...(breakdown?.memoryFiles ?? [])].sort((a, b) => b.tokens - a.tokens).slice(0, 4)

    return (
      <Box flexDirection="column">
        <Box>
          <Text color={heat(percent)}>{bar(percent / 100, gaugeWidth, '█', '░')}</Text>
          <Text bold> {percent}%</Text>
        </Box>
        <Text dimColor>
          {formatK(usage.context.tokens ?? breakdown?.totalTokens ?? 0)} of {formatK(usage.context.window)} tokens
          {usage.cost !== undefined ? `  ·  $${usage.cost.usd.toFixed(2)}` : ''}
          {usage.rateLimits.map(l => `  ·  ${limitName(l.kind)} ${Math.round(l.percentUsed)}%`).join('')}
        </Text>

        {used.length > 0 && <Text bold>{'\n'}By category</Text>}
        {used.map((c, i) => (
          <Box key={c.name}>
            <Text>{c.name.padEnd(20).slice(0, 20)} </Text>
            <Text color={PALETTE[i % PALETTE.length]}>{bar(c.tokens / total, rowWidth, '■', ' ')}</Text>
            <Text dimColor> {formatK(c.tokens).padStart(5)}</Text>
          </Box>
        ))}

        {mcp.length > 0 && <Text bold>{'\n'}Heaviest MCP tools</Text>}
        {mcp.map(t => (
          <Text key={t.name} dimColor>
            {formatK(t.tokens).padStart(5)}  {t.name}
          </Text>
        ))}

        {memory.length > 0 && <Text bold>{'\n'}Memory files</Text>}
        {memory.map(f => (
          <Text key={f.path} dimColor>
            {formatK(f.tokens).padStart(5)}  {shortPath(f.path)}
          </Text>
        ))}

        {files.length > 0 && <Text bold>{'\n'}Edited this session ({files.length})</Text>}
        {files.length > 0 && <Text dimColor>{files.slice(-6).map(shortPath).join('  ')}</Text>}

        <Box>
          <Button key="close" label="Close" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
      </Box>
    )
  })
}
