import { expect, mock, test } from 'claude-code/testing'

import { formatElapsed, labelFor, remoteOf, shortenCommand, spinnerText } from './register'

test('labels common tools', async () => {
  expect(labelFor('Bash', { command: 'bun test --watch\nmore' })).toEqual({ label: '$ bun test --watch' })
  expect(labelFor('Bash', { command: 'bun test', description: 'Run the tests' })).toEqual({ label: 'Run the tests', detail: 'bun test' })
  expect(labelFor('Read', { file_path: '/a/b/register.ts' }).label).toBe('Reading register.ts')
  expect(labelFor('WebFetch', { url: 'https://docs.anthropic.com/x' }).label).toBe('Fetching docs.anthropic.com')
  expect(labelFor('mcp__claude_ai_Gmail__search_threads', {}).label).toBe('Gmail: search_threads')
})

test('shortens noisy commands', async () => {
  expect(shortenCommand('cd /Users/aaron/workspace/app && FOO=1 bun test src/x.test.ts')).toBe('bun test src/x.test.ts')
  expect(shortenCommand('xcodebuild -project /Users/aaron/dev/stenobar/Stenobar.xcodeproj -scheme App | tail -20')).toBe('xcodebuild -project Stenobar.xcodeproj -scheme App | …')
  expect(shortenCommand("grep -rn 'a|b' src")).toBe("grep -rn 'a|b' src")
})

test('fits the width: detail only when whole, label clipped last', async () => {
  const call = { label: 'Run the tests', detail: 'bun test --coverage' }
  expect(spinnerText(call, 0, 80)).toBe('Run the tests · bun test --coverage')
  expect(spinnerText(call, 0, 25)).toBe('Run the tests')
  expect(spinnerText({ label: '$ ' + 'x'.repeat(50) }, 2, 30)).toBe(`$ ${'x'.repeat(22)}… (+2)`)
})

test('spinner shows the running tool, then falls back', async ($, on) => {
  mock.clock(on)
  const props = { word: 'Baking', message: null, suffix: '…', mode: 'tool-use' as const }
  let shown: string | null = null
  let during: string | null = null

  on('ui.render', { component: 'Spinner' }, (t, e) => {
    shown = e.props.message ?? e.props.word
    const { Text } = t.ui.resolve(e)

    return h(Text, null, shown) as never
  })
  on('tool.call', async () => {
    await $.ui.render({ surface: 'terminal', component: 'Spinner', requestId: 'main', props })
    during = shown

    return { result: { stdout: '', stderr: '', interrupted: false } as never }
  })

  await $.tool.call({ tool: 'Bash', command: 'cd /tmp && git status', description: 'Show status' })
  expect(during).toBe('Show status · git status')

  await $.ui.render({ surface: 'terminal', component: 'Spinner', requestId: 'main', props })
  expect(shown).toBe('Baking')
})

test('ssh shows the host', async () => {
  expect(remoteOf("ssh -p 22 root@seedbox 'systemctl status pveproxy'")).toEqual({ host: 'seedbox', remote: 'systemctl status pveproxy' })
  expect(labelFor('Bash', { command: "ssh seedbox 'df -h'" })).toEqual({ label: 'seedbox › df -h' })
  expect(labelFor('Bash', { command: 'ssh vesta uptime', description: 'Check uptime' })).toEqual({ label: 'Check uptime', detail: 'on vesta' })
  expect(labelFor('Bash', { command: 'ssh seedbox uptime', description: 'Check uptime on seedbox' })).toEqual({ label: 'Check uptime on seedbox' })
  expect(remoteOf('git status')).toBe(null)
})

test('elapsed joins the label after 15s', async () => {
  expect(formatElapsed(100_000)).toBe('1m 40s')
  expect(spinnerText({ label: 'Build the app', detail: 'xcodebuild' }, 0, 80, 5_000)).toBe('Build the app · xcodebuild')
  expect(spinnerText({ label: 'Build the app', detail: 'xcodebuild' }, 0, 80, 100_000)).toBe('Build the app · xcodebuild · 1m 40s')
  expect(spinnerText({ label: 'Build the app', detail: 'xcodebuild' }, 0, 30, 100_000)).toBe('Build the app · 1m 40s')
})
