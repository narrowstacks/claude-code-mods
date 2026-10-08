import { expect, test } from 'claude-code/testing'

import { findPrUrls, isPollLoop, labelOf, summarize } from './register'

test('finds GitHub and Graphite PR urls', async () => {
  const text = 'https://github.com/a/web/pull/239 and https://app.graphite.dev/github/pr/a/web/240'
  expect(findPrUrls(text)).toEqual(['https://github.com/a/web/pull/239', 'https://github.com/a/web/pull/240'])
})

test('labels a PR as repo#number', async () => {
  expect(labelOf('https://github.com/narrowstacks/dorkroom/pull/393')).toBe('dorkroom#393')
})

test('spots foreground CI polling loops', async () => {
  expect(isPollLoop('for i in $(seq 1 40); do gh pr view 239 --json state; sleep 30; done')).toBe(true)
  expect(isPollLoop('gh pr checks 239 --watch')).toBe(true)
  expect(isPollLoop('sleep 45; gh pr view 239')).toBe(true)
  expect(isPollLoop('gh pr checks 239')).toBe(false)
  expect(isPollLoop('gh pr create --fill')).toBe(false)
})

test('summarizes check rollups', async () => {
  const s = summarize([
    { status: 'COMPLETED', conclusion: 'SUCCESS' },
    { status: 'IN_PROGRESS', conclusion: null },
    { state: 'FAILURE' },
  ])
  expect(s).toEqual({ passed: 1, failed: 1, pending: 1, verdict: 'failing' })
})

test('denies a blocking poll loop', async ($, on) => {
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } as never }))
  const ran = await $.tool.call({ tool: 'Bash', command: 'gh pr checks 12 --watch' })
  expect(ran.deny ?? (ran.isError ? ran.text : undefined)).toContain('pr-watch')

  const bg = await $.tool.call({ tool: 'Bash', command: 'gh pr checks 12 --watch', run_in_background: true })
  expect(bg.deny).toBe(undefined)
})
