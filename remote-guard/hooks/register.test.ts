import { expect, test } from 'claude-code/testing'

import { isDestructive, sshCalls } from './register'

test('finds the host and remote command', async () => {
  expect(sshCalls("ssh seedbox 'systemctl restart pveproxy'")).toEqual([{ host: 'seedbox', remote: 'systemctl restart pveproxy' }])
  expect(sshCalls('ssh -p 2222 -o BatchMode=yes root@vesta df -h')).toEqual([{ host: 'vesta', remote: 'df -h' }])
  expect(sshCalls('git log | grep ssh')).toEqual([])
})

test('flags destructive remote commands only', async () => {
  expect(isDestructive('systemctl restart pveproxy')).toBe(true)
  expect(isDestructive('rm -rf /srv/old')).toBe(true)
  expect(isDestructive('pct stop 101')).toBe(true)
  expect(isDestructive('systemctl status pveproxy')).toBe(false)
  expect(isDestructive('docker ps')).toBe(false)
  expect(isDestructive('journalctl -u pveproxy -n 50')).toBe(false)
})

test('asks, and denies on cancel', async ($, on) => {
  on('tool.call', { tool: 'AskUserQuestion' }, () => ({ result: { answers: {} } as never }))
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } as never }))
  const ran = await $.tool.call({ tool: 'Bash', command: "ssh seedbox 'reboot'" })
  expect(ran.deny ?? (ran.isError ? ran.text : '')).toContain('remote-guard')

  const safe = await $.tool.call({ tool: 'Bash', command: "ssh seedbox 'uptime'" })
  expect(safe.deny).toBe(undefined)
})

test('always allow covers that host for the rest of the session', async ($, on) => {
  let asked = 0
  on('tool.call', { tool: 'AskUserQuestion' }, (_t, e) => {
    asked += 1
    const question = e.questions[0]?.question ?? ''

    return { result: { questions: e.questions, answers: { [question]: 'Always allow on seedbox this session' } } as never }
  })
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } as never }))

  expect((await $.tool.call({ tool: 'Bash', command: "ssh seedbox 'reboot'" })).deny).toBe(undefined)
  expect((await $.tool.call({ tool: 'Bash', command: "ssh seedbox 'pct stop 101'" })).deny).toBe(undefined)
  expect(asked).toBe(1)

  await $.tool.call({ tool: 'Bash', command: "ssh vesta 'reboot'" })
  expect(asked).toBe(2)
})
