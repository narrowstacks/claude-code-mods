import { expect, test } from 'claude-code/testing'

import { canRemove, mergedRemovable, parseStatus, parseWorktrees } from './register'
import type { WorktreeRow } from '../types'

const PORCELAIN = `worktree /w/stenobar
HEAD fb84
branch refs/heads/main

worktree /w/wt/wt-090
HEAD 39f0
branch refs/heads/fix/090-moves

worktree /w/wt/wt-x
HEAD 1234
detached
`

test('parses worktree porcelain', async () => {
  expect(parseWorktrees(PORCELAIN)).toEqual([
    { path: '/w/stenobar', branch: 'main', isBare: false },
    { path: '/w/wt/wt-090', branch: 'fix/090-moves', isBare: false },
    { path: '/w/wt/wt-x', branch: null, isBare: false },
  ])
})

test('parses status: changes and ahead/behind', async () => {
  expect(parseStatus('# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 a b f.swift\n? new.txt\n'))
    .toEqual({ dirty: 2, ahead: 2, behind: 1 })
  expect(parseStatus('# branch.head x\n')).toEqual({ dirty: 0, ahead: undefined, behind: undefined })
})

const row = (over: Partial<WorktreeRow>): WorktreeRow => ({ path: '/p', name: 'p', branch: 'b', isMain: false, isCurrent: false, dirty: 0, ...over })

test('only clean, finished, non-main, non-current worktrees can be removed', async () => {
  expect(canRemove(row({ pr: { number: 1, state: 'MERGED' } }))).toBe(true)
  expect(canRemove(row({ pr: { number: 1, state: 'CLOSED' } }))).toBe(true)
  expect(canRemove(row({ pr: { number: 1, state: 'OPEN' } }))).toBe(false)
  expect(canRemove(row({}))).toBe(false)
  expect(canRemove(row({ dirty: 1, pr: { number: 1, state: 'MERGED' } }))).toBe(false)
  expect(canRemove(row({ isMain: true, pr: { number: 1, state: 'MERGED' } }))).toBe(false)
  expect(canRemove(row({ isCurrent: true, pr: { number: 1, state: 'MERGED' } }))).toBe(false)
})

test('the pane lists worktrees with PR state and offers Remove only where safe', async ($, on) => {
  on('session.root', () => ({ value: '/w/stenobar' }) as never)
  on('session.cwd', () => ({ value: '/w/stenobar' }) as never)
  on('command.run', () => ({ text: '' }))
  on('ui.open', () => ({ value: { isShown: true } }) as never)
  on('process.run', (_t, e) => {
    const argv = (e as { argv: string[] }).argv
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (argv.includes('worktree')) return out(PORCELAIN)
    if (argv.includes('status')) return out(argv.includes('/w/wt/wt-x') ? '? junk\n' : '# branch.ab +0 -0\n')
    if (argv[0] === 'gh') return out(argv.includes('fix/090-moves') ? '[{"number":90,"state":"MERGED"}]' : '[]')

    return out('')
  })

  await $.command.run({ command: 'worktrees', args: '' } as never)
  const ui = await $.ui.mount({ plugin: 'worktrees', surface: 'terminal', component: 'Pane', requestId: 'worktrees', props: {} as never })
  await $.ui.press({ plugin: 'worktrees', key: 'refresh' })
  expect((await ui.findAll({ type: 'Text', text: /#90 merged/ })).length).toBe(1)
  expect((await ui.findAll({ type: 'Button' })).map(b => b.key)).toEqual(['remove-wt-090', 'refresh', 'remove-merged'])
})

test('remove all merged takes merged rows only', async () => {
  const list = [
    row({ name: 'a', pr: { number: 1, state: 'MERGED' } }),
    row({ name: 'b', pr: { number: 2, state: 'CLOSED' } }),
    row({ name: 'c', dirty: 2, pr: { number: 3, state: 'MERGED' } }),
    row({ name: 'd', pr: { number: 4, state: 'OPEN' } }),
  ]
  expect(mergedRemovable(list).map(r => r.name)).toEqual(['a'])
})

test('remove all merged asks once, removes each, then reloads', async ($, on) => {
  const removed: string[] = []
  let asked = 0
  let porcelain = PORCELAIN
  on('session.root', () => ({ value: '/w/stenobar' }) as never)
  on('session.cwd', () => ({ value: '/w/stenobar' }) as never)
  on('command.run', () => ({ text: '' }))
  on('ui.open', () => ({ value: { isShown: true } }) as never)
  on('tool.call', { tool: 'AskUserQuestion' }, (_t, e) => {
    asked += 1
    const question = e.questions[0]?.question ?? ''

    return { result: { questions: e.questions, answers: { [question]: 'Remove all' } } as never }
  })
  on('process.run', (_t, e) => {
    const argv = (e as { argv: string[] }).argv
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (argv.includes('remove')) {
      removed.push(argv.at(-1) ?? '')
      porcelain = porcelain.split('\n\n').filter(block => !block.includes(argv.at(-1) ?? '')).join('\n\n')

      return out('')
    }
    if (argv.includes('worktree')) return out(porcelain)
    if (argv.includes('status')) return out(argv.includes('/w/wt/wt-x') ? '? junk\n' : '# branch.ab +0 -0\n')
    if (argv[0] === 'gh') return out(argv.includes('fix/090-moves') ? '[{"number":90,"state":"MERGED"}]' : '[]')

    return out('')
  })

  await $.command.run({ command: 'worktrees', args: '' } as never)
  const ui = await $.ui.mount({ plugin: 'worktrees', surface: 'terminal', component: 'Pane', requestId: 'worktrees', props: {} as never })
  await $.ui.press({ plugin: 'worktrees', key: 'refresh' })
  await $.ui.press({ plugin: 'worktrees', key: 'remove-merged' })
  expect(asked).toBe(1)
  expect(removed).toEqual(['/w/wt/wt-090'])
  expect((await ui.findAll({ type: 'Button', key: 'remove-merged' })).length).toBe(0)
})
