import { expect, mock, test } from 'claude-code/testing'

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
    { state: 'FAILURE', context: 'lint' },
  ])
  expect(s).toEqual({ passed: 1, failed: 1, pending: 1, verdict: 'failing', failing: ['lint'] })
})

test('denies a blocking poll loop', async ($, on) => {
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } as never }))
  const ran = await $.tool.call({ tool: 'Bash', command: 'gh pr checks 12 --watch' })
  expect(ran.deny ?? (ran.isError ? ran.text : undefined)).toContain('pr-watch')

  const bg = await $.tool.call({ tool: 'Bash', command: 'gh pr checks 12 --watch', run_in_background: true })
  expect(bg.deny).toBe(undefined)
})

const view = JSON.stringify({
  title: 'Add the gauge',
  state: 'OPEN',
  statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS', name: 'build' }, { status: 'COMPLETED', conclusion: 'FAILURE', name: 'test' }],
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the band shows tracked PRs on ${surface} and hides`, async ($, on) => {
    const clock = mock.clock(on)
    on('ui.render', { component: 'AbovePrompt' }, (t, e) => {
      const { Box } = t.ui.resolve(e)

      return h(Box, null) as never
    })
    on('command.run', () => ({ text: '' }))
    on('ui.toast', () => ({ value: undefined }) as never)
    on('process.run', () => ({ value: { exitCode: 0, stdout: view, stderr: '' } }) as never)
    await $.command.run({ command: 'prs', args: 'add https://github.com/a/web/pull/1' } as never)
    // /prs add fetches in the background; the minute poll fetches again and is awaited.
    await clock.advance(60_000)
    const band = await $.ui.mount({ plugin: 'pr-watch', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10 } as never })

    if (surface === 'desktop') {
      expect(await band.findAll({ type: 'Link', text: 'web#1' })).toHaveLength(1)
      expect(await band.findAll({ type: 'Svg' })).toHaveLength(1)
      expect(await band.findAll({ type: 'Text', text: 'failing: test' })).toHaveLength(1)
    } else {
      expect(await band.findAll({ type: 'Text', text: /web#1 1\/2/ })).toHaveLength(1)
    }

    await $.ui.press({ plugin: 'pr-watch', key: 'hide' })
    expect(await band.findAll({ text: /web#1/ })).toHaveLength(0)
  })
}
