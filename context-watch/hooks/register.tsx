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

// Hex twins of PALETTE for Svg, which draws as an isolated image.
const PALETTE_HEX = ['#39c5cf', '#bc8cff', '#58a6ff', '#d29922', '#3fb950', '#ff7b72', '#f778ba']

type Segment = { name: string; tokens: number; color: string; opacity?: number }

// One stacked bar of the window; the legend beneath it names each segment.
export const stackSvg = (segments: Segment[], total: number, width = 600, height = 14) => {
  let x = 0
  const rects = segments.map(seg => {
    const w = total > 0 ? (seg.tokens / total) * width : 0
    const rect = `<rect x="${x.toFixed(2)}" width="${w.toFixed(2)}" height="${height}" fill="${seg.color}" fill-opacity="${seg.opacity ?? 1}"/>`
    x += w

    return rect
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<clipPath id="c"><rect width="${width}" height="${height}" rx="5"/></clipPath>`
    + `<g clip-path="url(#c)"><rect width="${width}" height="${height}" fill="#8b949e" fill-opacity="0.15"/>${rects.join('')}</g></svg>`
}

// claude.ai connectors register under a bare UUID, so shorten those to something readable.
const serverLabel = (name: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name) ? `connector ${name.slice(0, 8)}` : name

// Loaded MCP tools summed by server, heaviest first; unloaded ones take no context yet.
export const mcpServers = (tools: readonly { serverName: string; tokens: number; isLoaded: boolean }[], limit = 6) => {
  const byServer = new Map<string, { name: string; tokens: number; tools: number }>()
  for (const tool of tools.filter(t => t.isLoaded)) {
    const server = byServer.get(tool.serverName) ?? { name: serverLabel(tool.serverName), tokens: 0, tools: 0 }
    server.tokens += tool.tokens
    server.tools += 1
    byServer.set(tool.serverName, server)
  }

  return [...byServer.values()].sort((a, b) => b.tokens - a.tokens).slice(0, limit)
}

const swatchSvg = (color: string, opacity = 1) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10" rx="2.5" fill="${color}" fill-opacity="${opacity}"/></svg>`

const formatTokens = (tokens: number) =>
  tokens >= 1_000_000 ? `${+(tokens / 1_000_000).toFixed(1)}M` : formatK(tokens)

export const bar = (fraction: number, width: number, full = '▰', empty = '▱') => {
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * width)

  return full.repeat(filled) + empty.repeat(width - filled)
}

const heat = (percent: number) => (percent >= 80 ? 'red' : percent >= 60 ? 'yellow' : 'green')

// Svg draws as an isolated image, so it takes fixed colors that read on light and dark alike.
const HEAT_HEX = { green: '#3fb950', yellow: '#d29922', red: '#f85149' }

// A rounded gauge for surfaces with Svg, ticked at the toast thresholds when `ticks` is set.
export const gaugeSvg = (percent: number, width: number, height: number, ticks = false, color = HEAT_HEX[heat(percent)]) => {
  const r = height / 2
  const fill = Math.min(width, Math.max(0, (percent / 100) * width))
  const marks = ticks
    ? THRESHOLDS.slice(0, 2).map(t => `<rect x="${(t / 100) * width - 0.5}" y="0" width="1" height="${height}" fill="#8b949e" fill-opacity="0.6"/>`).join('')
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<clipPath id="c"><rect width="${width}" height="${height}" rx="${r}"/></clipPath>`
    + `<g clip-path="url(#c)"><rect width="${width}" height="${height}" fill="#8b949e" fill-opacity="0.22"/>`
    + `<rect width="${fill}" height="${height}" fill="${color}"/>${marks}</g></svg>`
}

const limitName = (kind: string) =>
  kind === 'five_hour' ? '5h' : kind === 'seven_day' ? '7d' : kind

// "resets in 2h 10m", from the window's ISO reset time.
export const resetsIn = (resetsAt: string | undefined, now: number) => {
  const at = resetsAt === undefined ? NaN : Date.parse(resetsAt)
  if (Number.isNaN(at)) {
    return undefined
  }

  const minutes = Math.max(0, Math.round((at - now) / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const left = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`

  return `resets in ${left}`
}

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
    parts.push(`${limitName(limit.kind)} ${Math.round(limit.percentUsed)}%`)
  }

  return parts.join('  ·  ')
}

const refresh = async ($: EngineInterface) => {
  const usage = await $.session.usage()
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
    // Clears the status line an earlier version of this mod pinned.
    $.ui.status(undefined)
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

  // One line above the prompt, stacked over whatever the plugins beneath draw there.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) {
      return below
    }

    await read($, tick)
    const usage = await $.session.usage().catch(() => undefined)
    const percent = usage?.context.percent
    if (usage === undefined || percent === undefined) {
      return below
    }

    if (e.surface === 'desktop') {
      const { Box, Text, Svg } = $.ui.resolve(e)
      const now = await $.clock.now()

      return (
        <Box flexDirection="column">
          <Box alignItems="center" columnGap={1}>
            <Text dimColor>Context</Text>
            <Svg source={gaugeSvg(percent, 160, 8, true)} alt={`Context ${percent}% full`} width={160} height={8} />
            <Text bold color={percent >= 60 ? heat(percent) : undefined}>{percent}%</Text>
            <Text dimColor>
              {formatTokens(usage.context.tokens ?? 0)} / {formatTokens(usage.context.window)}
            </Text>
            {usage.cost !== undefined ? <Text dimColor>·  ${usage.cost.usd.toFixed(2)}</Text> : null}
            {usage.rateLimits.map(limit => (
              <Box key={`limit-${limit.kind}`} alignItems="center" columnGap={1}>
                <Text dimColor>·  {limitName(limit.kind)}</Text>
                <Svg source={gaugeSvg(limit.percentUsed, 48, 6)} alt={`${limitName(limit.kind)} limit ${Math.round(limit.percentUsed)}% used`} width={48} height={6} />
                <Text color={limit.percentUsed >= 60 ? heat(limit.percentUsed) : undefined}>{Math.round(limit.percentUsed)}%</Text>
                {resetsIn(limit.resetsAt, now) !== undefined
                  ? <Box display="none" hover={{ display: 'flex' }}><Text dimColor>{resetsIn(limit.resetsAt, now)}</Text></Box>
                  : null}
              </Box>
            ))}
          </Box>
          {below}
        </Box>
      )
    }

    const { Box, Text } = $.ui.resolve(e)
    const extras = statusText(usage).split('  ·  ').slice(1)

    return (
      <Box flexDirection="column">
        <Box>
          <Text dimColor>ctx </Text>
          <Text color={heat(percent)}>{bar(percent / 100, 10)}</Text>
          <Text color={percent >= 60 ? heat(percent) : undefined}> {percent}%</Text>
          <Text dimColor>
            {' '}{formatK(usage.context.tokens ?? 0)}/{formatK(usage.context.window)}
            {extras.map(part => `  ·  ${part}`).join('')}
          </Text>
        </Box>
        {below}
      </Box>
    )
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

    if (e.surface === 'desktop') {
      const { Svg } = $.ui.resolve(e)
      const total = breakdown?.rawMaxTokens ?? usage.context.window
      const percent = usage.context.percent ?? breakdown?.percentage ?? 0
      const categories = breakdown?.categories ?? []
      const used = categories.filter(c => c.kind === 'used' && c.tokens > 0).sort((a, b) => b.tokens - a.tokens)
      const segments: Segment[] = [
        ...used.map((c, i) => ({ name: c.name, tokens: c.tokens, color: PALETTE_HEX[i % PALETTE_HEX.length] ?? '#58a6ff' })),
        ...categories.filter(c => c.kind === 'buffer' && c.tokens > 0).map(c => ({ name: c.name, tokens: c.tokens, color: '#8b949e', opacity: 0.45 })),
      ]
      const servers = mcpServers(breakdown?.mcpTools ?? [])
      const deferred = (breakdown?.mcpTools ?? []).filter(t => !t.isLoaded).length
      const memory = [...(breakdown?.memoryFiles ?? [])].sort((a, b) => b.tokens - a.tokens).slice(0, 4)
      const heaviest = servers[0]?.tokens ?? 1

      return (
        <Box flexDirection="column" rowGap={1}>
          <Box alignItems="center" columnGap={1}>
            <Text bold color={percent >= 60 ? heat(percent) : undefined}>{percent}%</Text>
            <Text dimColor>
              {formatTokens(usage.context.tokens ?? breakdown?.totalTokens ?? 0)} of {formatTokens(usage.context.window)} tokens
              {usage.cost !== undefined ? `  ·  $${usage.cost.usd.toFixed(2)}` : ''}
              {usage.rateLimits.map(l => `  ·  ${limitName(l.kind)} ${Math.round(l.percentUsed)}%`).join('')}
            </Text>
          </Box>
          <Svg source={stackSvg(segments, total)} alt={`Context ${percent}% full`} />

          <Box flexDirection="column">
            {segments.map(seg => (
              <Box key={`cat-${seg.name}`} alignItems="center" columnGap={1}>
                <Svg source={swatchSvg(seg.color, seg.opacity)} alt={seg.name} width={10} height={10} />
                <Text>{seg.name}</Text>
                <Text dimColor>{formatTokens(seg.tokens)} · {((seg.tokens / total) * 100).toFixed(1)}%</Text>
              </Box>
            ))}
          </Box>

          {(servers.length > 0 || deferred > 0) && (
            <Box flexDirection="column">
              <Text bold>MCP servers in context</Text>
              {servers.map(server => (
                <Box key={`mcp-${server.name}`} alignItems="center" columnGap={1}>
                  <Svg source={gaugeSvg((server.tokens / heaviest) * 100, 80, 6, false, '#58a6ff')} alt={`${server.name} ${formatTokens(server.tokens)}`} width={80} height={6} />
                  <Text>{server.name}</Text>
                  <Text dimColor>{formatTokens(server.tokens)} · {server.tools} tool{server.tools === 1 ? '' : 's'}</Text>
                </Box>
              ))}
              {deferred > 0 && <Text dimColor>{deferred} more tool{deferred === 1 ? '' : 's'} load on demand and use no context until searched for</Text>}
            </Box>
          )}

          {memory.length > 0 && (
            <Box flexDirection="column">
              <Text bold>Memory files</Text>
              {memory.map(f => (
                <Text key={f.path} dimColor>{formatTokens(f.tokens)}  {shortPath(f.path)}</Text>
              ))}
            </Box>
          )}

          {files.length > 0 && (
            <Box flexDirection="column">
              <Text bold>Edited this session ({files.length})</Text>
              <Text dimColor>{files.slice(-6).map(shortPath).join('  ')}</Text>
            </Box>
          )}

          <Box>
            <Button key="close" label="Close" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
          </Box>
        </Box>
      )
    }

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
