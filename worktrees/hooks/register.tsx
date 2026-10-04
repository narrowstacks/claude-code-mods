import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PrState, WorktreeRow } from '../types'

const rows = atom({ plugin: 'worktrees', key: 'rows' } as const, [] as WorktreeRow[])
const isLoading = atom({ plugin: 'worktrees', key: 'isLoading' } as const, false)
const error = atom({ plugin: 'worktrees', key: 'error' } as const, null as string | null)

const PANE = 'worktrees'
const GH_CONCURRENCY = 4

export type Listed = { path: string; branch: string | null; isBare: boolean }

// `git worktree list --porcelain`: blank-line separated records, the first the main worktree.
export const parseWorktrees = (porcelain: string): Listed[] =>
  porcelain
    .split(/\n\s*\n/)
    .map(block => block.trim())
    .filter(Boolean)
    .flatMap(block => {
      const lines = block.split('\n')
      const path = lines.find(line => line.startsWith('worktree '))?.slice('worktree '.length)
      if (path === undefined) {
        return []
      }
      const branch = lines.find(line => line.startsWith('branch '))?.slice('branch '.length).replace(/^refs\/heads\//, '') ?? null

      return [{ path, branch, isBare: lines.includes('bare') }]
    })

// `git status --porcelain=v2 --branch`: changed entries, and `# branch.ab +A -B` when tracking.
export const parseStatus = (text: string) => {
  const lines = text.split('\n').filter(Boolean)
  const ab = lines.find(line => line.startsWith('# branch.ab '))?.match(/\+(\d+) -(\d+)/)

  return {
    dirty: lines.filter(line => !line.startsWith('#')).length,
    ahead: ab ? Number(ab[1]) : undefined,
    behind: ab ? Number(ab[2]) : undefined,
  }
}

export const canRemove = (row: WorktreeRow) =>
  !row.isMain && !row.isCurrent && row.dirty === 0 && (row.pr?.state === 'MERGED' || row.pr?.state === 'CLOSED')

export const mergedRemovable = (list: readonly WorktreeRow[]) =>
  list.filter(row => canRemove(row) && row.pr?.state === 'MERGED')

const base = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path

const isInside = (dir: string, path: string) => dir === path || dir.startsWith(`${path}/`)

// Runs `work` over `items`, at most `limit` at a time.
const pool = async <T,>(items: readonly T[], limit: number, work: (item: T) => Promise<void>) => {
  const queue = [...items]
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      await work(item)
    }
  })
  await Promise.all(workers)
}

const load = async ($: EngineInterface) => {
  await update($, isLoading, () => true)
  await update($, error, () => null)

  try {
    const root = await $.session.root()
    const cwd = await $.session.cwd()
    const listed = await $.process.run(['git', '-C', root, 'worktree', 'list', '--porcelain'])
    if (listed.exitCode !== 0) {
      await update($, rows, () => [])
      await update($, error, () => (listed.stderr.trim() || 'Not a git repository.'))

      return
    }

    const worktrees = parseWorktrees(listed.stdout).filter(one => !one.isBare)
    const current = [...worktrees].sort((a, b) => b.path.length - a.path.length).find(one => isInside(cwd, one.path))
    const built: WorktreeRow[] = []
    for (const [i, one] of worktrees.entries()) {
      const status = await $.process.run(['git', '-C', one.path, 'status', '--porcelain=v2', '--branch'])
      built.push({
        path: one.path,
        name: base(one.path),
        branch: one.branch,
        isMain: i === 0,
        isCurrent: one.path === current?.path,
        ...(status.exitCode === 0 ? parseStatus(status.stdout) : { dirty: 0 }),
      })
    }
    await update($, rows, () => built)

    const prs = new Map<string, { number: number; state: PrState }>()
    await pool(built.filter(row => row.branch !== null && !row.isMain), GH_CONCURRENCY, async row => {
      const found = await $.process
        .run(['gh', 'pr', 'list', '--head', row.branch ?? '', '--state', 'all', '--json', 'number,state', '--limit', '1'], { cwd: root, timeoutMs: 20_000 })
        .catch(() => undefined)
      if (found?.exitCode === 0) {
        const [pr] = JSON.parse(found.stdout || '[]') as { number: number; state: PrState }[]
        if (pr !== undefined) {
          prs.set(row.path, pr)
        }
      }
    })
    await update($, rows, all => all.map(row => ({ ...row, pr: prs.get(row.path) ?? row.pr })))
  } finally {
    await update($, isLoading, () => false)
  }
}

const remove = async ($: EngineInterface, row: WorktreeRow) => {
  const answer = await $.ui
    .ask(`Remove worktree ${row.name} (${row.branch ?? 'detached'})?`, { options: ['Remove', 'Cancel'], header: 'Worktree' })
    .catch(() => 'Cancel')
  if (answer !== 'Remove') {
    return
  }

  const root = await $.session.root()
  const ran = await $.process.run(['git', '-C', root, 'worktree', 'remove', row.path])
  if (ran.exitCode !== 0) {
    $.ui.toast(`Could not remove ${row.name}: ${(ran.stderr.trim().split('\n')[0] ?? '').slice(0, 120)}`)
  }
  await load($)
}

const removeMerged = async ($: EngineInterface) => {
  const targets = mergedRemovable(await read($, rows))
  if (targets.length === 0) {
    return
  }

  const names = targets.map(row => row.name).join(', ')
  const answer = await $.ui
    .ask(`Remove ${targets.length} merged worktree${targets.length === 1 ? '' : 's'}?  ${names}`, { options: ['Remove all', 'Cancel'], header: 'Worktrees' })
    .catch(() => 'Cancel')
  if (answer !== 'Remove all') {
    return
  }

  const root = await $.session.root()
  const failed: string[] = []
  for (const row of targets) {
    const ran = await $.process.run(['git', '-C', root, 'worktree', 'remove', row.path]).catch(() => undefined)
    if (ran?.exitCode !== 0) {
      failed.push(row.name)
    }
  }

  const removed = targets.length - failed.length
  $.ui.toast(failed.length === 0 ? `Removed ${removed} worktree${removed === 1 ? '' : 's'}` : `Removed ${removed}; could not remove ${failed.join(', ')}`)
  await load($)
}

const PR_COLOR: Record<PrState, string> = { MERGED: 'green', OPEN: 'yellow', CLOSED: 'red' }

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'worktrees', description: 'Git worktrees of this repo, with branch, changes and PR state' })

    return next(e)
  })

  on('command.run', { command: 'worktrees' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Worktrees' })
    load($).catch(reason => update($, error, () => String(reason)))

    return { text: 'Worktrees pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, rows)
    const loading = await read($, isLoading)
    const failed = await read($, error)
    const nameWidth = Math.min(24, Math.max(8, ...list.map(row => row.name.length)))
    const branchWidth = Math.max(10, Math.min(40, (e.viewport?.columns ?? 80) - nameWidth - 34))
    const merged = mergedRemovable(list).length
    const clip = (text: string, width: number) => (text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width))

    return (
      <Box flexDirection="column">
        {failed !== null && <Text color="red">{failed}</Text>}
        {failed === null && list.length === 0 && <Text dimColor>{loading ? 'Loading…' : 'No worktrees.'}</Text>}
        {list.map(row => (
          <Box key={row.path}>
            <Text bold={row.isCurrent}>{row.isCurrent ? '› ' : '  '}{clip(row.name, nameWidth)} </Text>
            <Text dimColor>{clip(row.branch ?? '(detached)', branchWidth)} </Text>
            {row.isMain && <Text dimColor>main </Text>}
            {row.dirty > 0 && <Text color="yellow">●{row.dirty} </Text>}
            {(row.ahead ?? 0) > 0 && <Text dimColor>↑{row.ahead} </Text>}
            {(row.behind ?? 0) > 0 && <Text dimColor>↓{row.behind} </Text>}
            {row.pr !== undefined && <Text color={PR_COLOR[row.pr.state]}>#{row.pr.number} {row.pr.state.toLowerCase()} </Text>}
            {canRemove(row) && <Button key={`remove-${row.name}`} label="Remove" onPress={() => remove($, row)} />}
          </Box>
        ))}
        <Box>
          <Button key="refresh" label={loading ? 'Refreshing…' : 'Refresh'} onPress={() => load($)} />
          {merged > 0 && !loading && (
            <Button key="remove-merged" label={`Remove ${merged} merged`} onPress={() => removeMerged($)} />
          )}
        </Box>
      </Box>
    )
  })
}
