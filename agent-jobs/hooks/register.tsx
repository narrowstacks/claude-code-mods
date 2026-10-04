import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, Register } from 'claude-code'

import type { Job, JobStatus } from '../types'

const jobs = atom({ plugin: 'agent-jobs', key: 'jobs' } as const, [] as Job[])
const now = atom({ plugin: 'agent-jobs', key: 'now' } as const, 0)
const expanded = atom({ plugin: 'agent-jobs', key: 'expanded' } as const, null as string | null)

const PANE = 'agent-jobs'
const TICK_MS = 2000
const KEEP_FINISHED = 5
const KEEP_RECENT = 6

export const formatElapsed = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) {
    return `${s}s`
  }
  const m = Math.floor(s / 60)
  if (m < 60) {
    return `${m}m ${s % 60}s`
  }

  return `${Math.floor(m / 60)}h ${m % 60}m`
}

const field = (input: object, key: string) => {
  const value = (input as Record<string, unknown>)[key]

  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

const base = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path

const firstLine = (text: string) => (text.split('\n')[0] ?? '').trim()

// One short line for what a tool call is doing.
export const activityOf = (tool: string, input: object): string => {
  const path = field(input, 'file_path') ?? field(input, 'notebook_path') ?? ''
  switch (tool) {
    case 'Bash':
      return field(input, 'description') ?? `$ ${firstLine(field(input, 'command') ?? '')}`
    case 'Read':
      return `Reading ${base(path)}`
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return `Editing ${base(path)}`
    case 'Grep':
      return `Searching "${firstLine(field(input, 'pattern') ?? '')}"`
    case 'Glob':
      return `Finding ${field(input, 'pattern') ?? ''}`
    case 'WebFetch':
      return `Fetching ${(field(input, 'url') ?? '').replace(/^https?:\/\/([^/]+).*$/, '$1')}`
    case 'WebSearch':
      return `Searching web: ${field(input, 'query') ?? ''}`
    case 'Agent':
    case 'Task':
      return `Agent: ${field(input, 'description') ?? 'working'}`
  }
  const mcp = tool.match(/^mcp__(.+?)__(.+)$/)

  return mcp !== null ? `${(mcp[1] ?? '').replace(/^claude_ai_|^plugin_/, '')}: ${mcp[2] ?? ''}` : tool
}

const statusOf = (status: AgentInfo['status']): JobStatus =>
  status === 'completed' || status === 'failed' || status === 'killed' ? status : 'running'

// Keeps every running job and the newest few finished ones.
export const trim = (list: readonly Job[]) => {
  const finished = list
    .filter(job => job.status !== 'running')
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    .slice(0, KEEP_FINISHED)

  return list.filter(job => job.status === 'running' || finished.includes(job))
}

// Reads `<task-id>` and `<status>` out of a background task's notification text.
export const parseNotification = (text: string) => {
  const id = text.match(/<task-id>([^<]+)<\/task-id>/)?.[1]?.trim()
  const status = text.match(/<status>([^<]+)<\/status>/)?.[1]?.trim()

  return id === undefined ? undefined : { id, status: status ?? 'completed' }
}

const finish = async ($: EngineInterface, id: string, status: JobStatus) => {
  const at = await $.clock.now()
  let done: Job | undefined
  await update($, jobs, list =>
    trim(
      list.map(job => {
        if (job.id !== id || job.status !== 'running') {
          return job
        }
        done = { ...job, status, endedAt: at }

        return done
      }),
    ),
  )
  if (done !== undefined && done.isBackground) {
    const mark = status === 'completed' ? 'done' : status
    $.ui.toast(`${done.kind === 'agent' ? 'Agent' : 'Job'} ${mark}: ${done.label}`)
  }
}

// Background work reports its end as a notification: as a turn of its own, or
// delivered into a running one.
const onNotice = async ($: EngineInterface, text: string) => {
  const notice = parseNotification(text)
  if (notice === undefined) {
    return
  }
  const status: JobStatus =
    notice.status === 'failed' ? 'failed' : notice.status === 'killed' ? 'killed' : 'completed'
  await finish($, notice.id, status)
}

const sync = async ($: EngineInterface, background: ReadonlySet<string>, early: Map<string, string[]>) => {
  const [agents, at, list] = await Promise.all([$.agent.list(), $.clock.now(), read($, jobs)])
  const known = new Map(list.map(job => [job.id, job]))

  const added: Job[] = []
  for (const agent of agents) {
    const status = statusOf(agent.status)
    const job = known.get(agent.id)
    if (job === undefined && status === 'running') {
      added.push({
        id: agent.id,
        kind: 'agent',
        label: agent.description || agent.type,
        detail: agent.type,
        startedAt: at,
        status,
        isBackground: background.has(agent.id),
        stopId: agent.name ?? agent.teammateId ?? agent.id,
        recent: early.get(agent.id),
      })
      early.delete(agent.id)
    } else if (job !== undefined && job.status === 'running' && status !== 'running') {
      await finish($, agent.id, status)
    }
  }
  if (added.length > 0) {
    await update($, jobs, all => trim([...all, ...added]))
  }

  const isRunning = (await read($, jobs)).some(job => job.status === 'running')
  if (isRunning || added.length > 0) {
    await update($, now, () => at)
  }
}

export const register: Register = on => {
  const background = new Set<string>()
  // Tool calls an agent made before the 2s sync listed it.
  const early = new Map<string, string[]>()

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'jobs', description: 'Running subagents and background shells' })
    $.clock.every(TICK_MS, () => {
      sync($, background, early).catch(() => undefined)
    })

    return next(e)
  })

  on('command.run', { command: 'jobs' }, async $ => {
    await sync($, background, early).catch(() => undefined)
    await $.ui.open({ id: PANE, title: 'Jobs' })

    return { text: 'Jobs pane opened.' }
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) {
      const id = e.agentId
      const line = activityOf(e.tool, e)
      const push = (list: readonly string[] = []) => [...list, line].slice(-KEEP_RECENT)
      const list = await read($, jobs)
      if (list.some(job => job.id === id)) {
        await update($, jobs, all => all.map(job => (job.id === id ? { ...job, recent: push(job.recent) } : job)))
      } else {
        early.set(id, push(early.get(id)))
      }
    }

    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) {
      return ran
    }

    const result = ran.result as Record<string, unknown> | undefined
    if (e.tool === 'Agent' && result?.status === 'async_launched' && typeof result.agentId === 'string') {
      const id = result.agentId
      background.add(id)
      await update($, jobs, list => list.map(job => (job.id === id ? { ...job, isBackground: true } : job)))
    }
    if (e.tool === 'Bash' && typeof result?.backgroundTaskId === 'string') {
      const id = result.backgroundTaskId
      const job: Job = {
        id,
        kind: 'shell',
        label: e.description ?? e.command.split('\n')[0] ?? 'shell',
        detail: e.description !== undefined ? e.command.split('\n')[0] : undefined,
        startedAt: await $.clock.now(),
        status: 'running',
        isBackground: true,
        stopId: id,
      }
      await update($, jobs, list => trim([...list.filter(one => one.id !== id), job]))
    }
    if (e.tool === 'TaskStop') {
      const id = e.task_id ?? e.shell_id
      const match = (await read($, jobs)).find(job => job.stopId === id || job.id === id)
      if (match !== undefined) {
        await finish($, match.id, 'killed')
      }
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId
    if (id !== undefined && e.answer.trim() !== '') {
      const outcome = firstLine(e.answer.trim())
      await update($, jobs, all => all.map(job => (job.id === id ? { ...job, outcome } : job)))
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'task-notification') {
      await onNotice($, e.text)
    }

    return next(e)
  })

  on('session.receive', async ($, e, next) => {
    if (e.origin.kind === 'task-notification') {
      await onNotice($, e.text)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, jobs)
    const open = await read($, expanded)
    const at = Math.max(await read($, now), ...list.map(job => job.startedAt))
    const running = list.filter(job => job.status === 'running')
    const finished = list.filter(job => job.status !== 'running')
    const width = Math.max(20, (e.viewport?.columns ?? 80) - 34)
    const clip = (text: string, room = width) => (text.length > room ? `${text.slice(0, room - 1)}…` : text)

    const stop = async (job: Job) => {
      const ran = await $.tool.call({ tool: 'TaskStop', task_id: job.stopId })
      if (ran.deny === undefined && ran.isError !== true) {
        await finish($, job.id, 'killed')
      } else {
        $.ui.toast(`Could not stop ${job.label}`)
      }
    }
    const toggle = (job: Job) => update($, expanded, current => (current === job.id ? null : job.id))
    const clear = () => update($, jobs, all => all.filter(job => job.status === 'running'))

    const details = (job: Job) =>
      open === job.id && (
        <Box key={`details-${job.id}`} flexDirection="column" paddingLeft={4}>
          {(job.recent ?? []).length === 0 && <Text dimColor>No tool calls seen yet.</Text>}
          {(job.recent ?? []).map((line, i) => (
            <Text key={`r-${i}`} dimColor>
              {clip(line, width + 10)}
            </Text>
          ))}
          {job.outcome !== undefined && <Text>{clip(`→ ${job.outcome}`, width + 10)}</Text>}
          {job.kind === 'agent' && <Text dimColor italic>Full transcript: open it from the tasks list.</Text>}
        </Box>
      )

    return (
      <Box flexDirection="column">
        {running.length === 0 && finished.length === 0 && <Text dimColor>Nothing running.</Text>}
        {running.map(job => (
          <Box key={job.id} flexDirection="column">
            <Box>
              <Text>● {clip(job.label)} </Text>
              <Text dimColor>
                {job.kind === 'shell' ? 'shell' : job.detail} · {formatElapsed(at - job.startedAt)}{' '}
              </Text>
              {job.kind === 'agent' && (
                <Button key={`open-${job.id}`} label={open === job.id ? 'Hide' : 'Open'} onPress={() => toggle(job)} />
              )}
              <Button key={`stop-${job.id}`} label="Stop" onPress={() => stop(job)} />
            </Box>
            {open !== job.id && job.recent !== undefined && job.recent.length > 0 && (
              <Text dimColor>  ↳ {clip(job.recent.at(-1) ?? '')}</Text>
            )}
            {details(job)}
          </Box>
        ))}
        {finished.map(job => (
          <Box key={job.id} flexDirection="column">
            <Box>
              <Text dimColor>
                {job.status === 'completed' ? '✓' : '✗'} {clip(job.label)} · {job.status === 'completed' ? '' : `${job.status} · `}
                {formatElapsed((job.endedAt ?? at) - job.startedAt)}{' '}
              </Text>
              {job.kind === 'agent' && (
                <Button key={`open-${job.id}`} label={open === job.id ? 'Hide' : 'Open'} onPress={() => toggle(job)} />
              )}
            </Box>
            {details(job)}
          </Box>
        ))}
        {finished.length > 0 && (
          <Box>
            <Button key="clear" label="Clear finished" onPress={clear} />
          </Box>
        )}
      </Box>
    )
  })
}
