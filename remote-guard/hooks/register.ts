import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const allowedHosts = atom({ plugin: 'remote-guard', key: 'allowedHosts' } as const, [] as string[])

// ssh options that take a value: the token after them is not the host.
const VALUED = new Set(['-b', '-c', '-D', '-E', '-e', '-F', '-I', '-i', '-J', '-L', '-l', '-m', '-O', '-o', '-p', '-Q', '-R', '-S', '-W', '-w', '-B'])

const DESTRUCTIVE: RegExp[] = [
  /\brm\s+(-\w*\s+)*\S/,
  /\b(systemctl|service)\b.*\b(restart|stop|disable|mask|kill)\b/,
  /\b(reboot|shutdown|poweroff|halt)\b/,
  /\b(kill|pkill|killall)\b/,
  /\bdocker\b.*\b(rm|rmi|stop|restart|kill|prune|down)\b/,
  /\b(pct|qm)\s+(stop|destroy|shutdown|reboot|reset|rollback)\b/,
  /\bzfs\s+(destroy|rollback)\b/,
  /\bzpool\s+(destroy|export)\b/,
  /\b(mkfs|wipefs|fdisk|parted)\b/,
  /\bdd\s+.*\bof=/,
  /\b(apt|apt-get|dnf|yum)\s+(remove|purge|autoremove)\b/,
  /\bmv\s+\S+\s+\/(etc|usr|var|boot)\b/,
  />\s*\/etc\//,
]

const unquote = (text: string) => text.trim().replace(/^(['"])([\s\S]*)\1$/, '$2')

// Each ssh invocation in the command: the host and what it runs there.
export const sshCalls = (command: string): { host: string; remote: string }[] => {
  const calls: { host: string; remote: string }[] = []
  for (const match of command.matchAll(/(?:^|[;&|(]\s*|\s)ssh\s+([^;&|]*(?:'[^']*'|"[^"]*")?[^;&|]*)/g)) {
    const tokens = (match[1] ?? '').match(/'[^']*'|"[^"]*"|\S+/g) ?? []
    let i = 0
    while (i < tokens.length && (tokens[i] ?? '').startsWith('-')) {
      i += VALUED.has(tokens[i] ?? '') ? 2 : 1
    }
    const host = tokens[i]
    if (host !== undefined) {
      calls.push({ host: host.replace(/^.*@/, ''), remote: unquote(tokens.slice(i + 1).join(' ')) })
    }
  }

  return calls
}

export const isDestructive = (remote: string) => DESTRUCTIVE.some(pattern => pattern.test(remote))

const RUN = 'Run it'
const CANCEL = 'Cancel'
const allowLabel = (host: string) => `Always allow on ${host} this session`

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const allowed = await read($, allowedHosts)
    const risky = sshCalls(e.command).find(call => isDestructive(call.remote) && !allowed.includes(call.host))
    if (risky === undefined) {
      return next(e)
    }

    const shown = risky.remote.length > 120 ? `${risky.remote.slice(0, 119)}…` : risky.remote
    const always = allowLabel(risky.host)
    const answer = await $.ui
      .ask(`Run this on ${risky.host}?  ${shown}`, { options: [RUN, always, CANCEL], header: 'Remote' })
      .catch(() => CANCEL)

    if (answer === always) {
      await update($, allowedHosts, hosts => [...hosts, risky.host])
    }

    return answer === RUN || answer === always
      ? next(e)
      : { deny: `remote-guard: the user did not approve running this on ${risky.host}${answer !== CANCEL ? `. They said: ${answer}` : ''}.` }
  })
}
