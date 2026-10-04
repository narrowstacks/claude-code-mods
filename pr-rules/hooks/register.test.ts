import { expect, mock, test } from 'claude-code/testing'

import { decide, parsePrCommand } from './register'

test('parses PR commands and labels', async () => {
  expect(parsePrCommand('gh pr create --fill --label bug,ui -l "no-changelog" --label=ios')).toEqual({ tool: 'gh', labels: ['bug', 'ui', 'no-changelog', 'ios'], cd: undefined })
  expect(parsePrCommand('cd ~/w/app && gt submit --stack')).toEqual({ tool: 'gt', labels: [], cd: '~/w/app' })
  expect(parsePrCommand('git push && gh pr create --title "x; y"')?.tool).toBe('gh')
  expect(parsePrCommand('gh pr view 12')).toBe(null)
})

const facts = { changelogs: ['CHANGELOG.md', 'CHANGELOG-iOS.md'], changed: ['Sources/a.swift'], requireLabels: true, availableLabels: ['bug', 'ui'] }

test('needs a changelog entry or the skip label', async () => {
  const pr = { tool: 'gh' as const, labels: ['bug'] }
  expect(decide(pr, facts)).toContain('CHANGELOG.md and/or CHANGELOG-iOS.md')
  expect(decide(pr, { ...facts, changed: ['CHANGELOG-iOS.md'] })).toBe(null)
  expect(decide({ ...pr, labels: ['chore', 'no-changelog'] }, facts)).toBe(null)
  expect(decide({ ...pr, labels: ['no-ios-changelog'] }, { ...facts, changelogs: ['CHANGELOG-iOS.md'] })).toBe(null)
})

test('needs labels where the repo asks', async () => {
  const pr = { tool: 'gh' as const, labels: [] }
  const touched = { ...facts, changed: ['CHANGELOG.md'] }
  expect(decide(pr, touched)).toContain('Labels in this repo: bug, ui')
  expect(decide(pr, { ...touched, requireLabels: false })).toBe(null)
  expect(decide({ tool: 'gt', labels: [] }, touched)).toBe(null)
})

test('denies gh pr create in a repo with an unlogged change', async ($, on) => {
  on('session.cwd', () => ({ value: '/r' }) as never)
  on('fs.list', () => ({ value: [{ name: 'CHANGELOG.md', kind: 'file', size: 1 }] }) as never)
  on('fs.read', () => ({ value: '# Changelog\n\n## [Unreleased]\n' }) as never)
  on('fs.exists', () => ({ value: false }) as never)
  on('process.run', (_t, e) => {
    const argv = (e as { argv: string[] }).argv.join(' ')
    const stdout = argv.includes('show-toplevel') ? '/r' : argv.includes('symbolic-ref') ? 'origin/main' : argv.includes('merge-base') ? 'abc' : 'src/a.ts'

    return { value: { exitCode: 0, stdout, stderr: '' } } as never
  })
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } as never }))

  const ran = await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill --label bug' })
  expect(ran.deny ?? (ran.isError ? ran.text : '')).toContain('No changelog entry')

  const skipped = await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill --label no-changelog' })
  expect(skipped.deny).toBe(undefined)
})

test('/pr-rules off skips the repo and auto restores it', async ($, on) => {
  mock.store(on)
  on('session.root', () => ({ value: '/r' }) as never)
  on('process.run', () => ({ value: { exitCode: 0, stdout: '/r\n', stderr: '' } }) as never)
  on('fs.list', () => ({ value: [] }) as never)
  on('fs.exists', () => ({ value: false }) as never)

  const off = await $.command.run({ command: 'pr-rules', args: 'off' } as never)
  expect(String((off as { text: string }).text)).toContain('off for /r')
  const still = await $.command.run({ command: 'pr-rules', args: '' } as never)
  expect(String((still as { text: string }).text)).toContain('off for /r')

  const auto = await $.command.run({ command: 'pr-rules', args: 'auto' } as never)
  expect(String((auto as { text: string }).text)).toContain('(auto)')

})
