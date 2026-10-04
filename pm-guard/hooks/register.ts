import type { EngineInterface, Register } from 'claude-code'

export type Manager = 'bun' | 'pnpm' | 'npm' | 'yarn'

const LOCKFILES: [string, Manager][] = [
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['package-lock.json', 'npm'],
  ['yarn.lock', 'yarn'],
]

const RUNNERS: Record<Manager, string> = { bun: 'bunx', pnpm: 'pnpm dlx', npm: 'npx', yarn: 'yarn dlx' }

// The program each top-level command starts with, and the directory a
// leading `cd` moves to. Quoted text is not split.
export const parseCommand = (command: string) => {
  const segments = command.split(/&&|\|\||;|\||\n/).map(s => s.trim()).filter(Boolean)
  const cd = command.match(/^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*(&&|;)/)?.[1]?.replace(/^["']|["']$/g, '')
  const programs = segments
    .map(s => s.replace(/^([A-Z_][A-Z0-9_]*=\S*\s+)+/, '').split(/\s+/)[0] ?? '')
    .filter(Boolean)

  return { programs, cd }
}

const managerOf = (program: string): Manager | undefined => {
  if (program === 'npm' || program === 'npx') return 'npm'
  if (program === 'yarn') return 'yarn'
  if (program === 'pnpm' || program === 'pnpx') return 'pnpm'
  if (program === 'bun' || program === 'bunx') return 'bun'

  return undefined
}

// What to say when `used` runs where `wanted` belongs, or null when fine.
export const verdict = (used: Manager, program: string, wanted: Manager | null): string | null => {
  if (wanted === null) {
    return used === 'npm' || used === 'yarn'
      ? `pm-guard: no lockfile here, and the user's rule is bun by default. Use ${program === 'npx' ? 'bunx' : 'bun'} instead of ${program}.`
      : null
  }
  if (used === wanted) {
    return null
  }

  const isRunner = program === 'npx' || program === 'pnpx' || program === 'bunx'

  return `pm-guard: this project uses ${wanted} (its lockfile says so). Use ${isRunner ? RUNNERS[wanted] : wanted} instead of ${program}.`
}

const resolve = async ($: EngineInterface, dir: string | undefined) => {
  const cwd = await $.session.cwd()
  if (dir === undefined) return cwd
  if (dir.startsWith('/')) return dir
  if (dir.startsWith('~')) return `${(await $.env.get('HOME')) ?? ''}${dir.slice(1)}`

  return `${cwd}/${dir}`
}

const lockfileManager = async ($: EngineInterface, start: string): Promise<Manager | null> => {
  let dir = start.replace(/\/+$/, '')
  while (dir !== '') {
    for (const [file, manager] of LOCKFILES) {
      if (await $.fs.exists(`${dir}/${file}`)) return manager
    }
    if (await $.fs.exists(`${dir}/.git`)) return null
    dir = dir.slice(0, dir.lastIndexOf('/'))
  }

  return null
}

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const { programs, cd } = parseCommand(e.command)
    const used = programs.map(program => ({ program, manager: managerOf(program) }))
      .find((one): one is { program: string; manager: Manager } => one.manager !== undefined)
    if (used === undefined) {
      return next(e)
    }

    const wanted = await lockfileManager($, await resolve($, cd))
    const reason = verdict(used.manager, used.program, wanted)

    return reason === null ? next(e) : { deny: reason }
  })
}
