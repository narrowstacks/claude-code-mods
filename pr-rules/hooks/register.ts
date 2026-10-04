import type { EngineInterface, Register } from 'claude-code'

export type PrCommand = { tool: 'gh' | 'gt'; labels: string[]; cd?: string }

const SEGMENT = /&&|\|\||;|\n/
const TOKENS = /"[^"]*"|'[^']*'|\S+/g
const unquote = (text: string) => text.replace(/^(["'])([\s\S]*)\1$/, '$2')

// The PR-opening command in `command`, its labels and a leading `cd`; null
// when the command opens no PR.
export const parsePrCommand = (command: string): PrCommand | null => {
  const cd = command.match(/^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*(&&|;)/)?.[1]
  for (const segment of command.split(SEGMENT)) {
    const tokens = (segment.trim().match(TOKENS) ?? []).map(unquote)
    const start = tokens.findIndex((token, i) => token === 'gh' && tokens[i + 1] === 'pr' && tokens[i + 2] === 'create')
    if (start !== -1) {
      const labels: string[] = []
      for (let i = start + 3; i < tokens.length; i += 1) {
        const token = tokens[i] ?? ''
        const inline = token.match(/^--label=(.*)$/)?.[1]
        const value = inline ?? (token === '--label' || token === '-l' ? tokens[i + 1] : undefined)
        if (value !== undefined) {
          labels.push(...value.split(',').map(label => label.trim()).filter(Boolean))
          if (inline === undefined) i += 1
        }
      }

      return { tool: 'gh', labels, cd: cd === undefined ? undefined : unquote(cd) }
    }
    if (tokens[0] === 'gt' && (tokens[1] === 'submit' || tokens[1] === 'ss')) {
      return { tool: 'gt', labels: [], cd: cd === undefined ? undefined : unquote(cd) }
    }
  }

  return null
}

export type RepoFacts = {
  changelogs: string[]
  changed: string[]
  requireLabels: boolean
  availableLabels: string[]
}

// Why the PR should not open yet, or null when it may.
export const decide = (pr: PrCommand, facts: RepoFacts): string | null => {
  const problems: string[] = []

  if (facts.changelogs.length > 0) {
    const touched = facts.changelogs.filter(file => facts.changed.includes(file))
    const onlyIos = facts.changelogs.every(file => /ios/i.test(file))
    const skipped = pr.labels.includes('no-changelog') || (onlyIos && pr.labels.includes('no-ios-changelog'))
    if (touched.length === 0 && !skipped) {
      const skip = pr.tool === 'gh' ? `pass --label ${onlyIos ? 'no-ios-changelog' : 'no-changelog'}` : 'add the no-changelog label after submitting'
      problems.push(
        `No changelog entry on this branch: add one under [Unreleased] in ${facts.changelogs.join(' and/or ')} for the change, or, if it needs none (refactor, tests, CI), ${skip}.`,
      )
    }
  }

  if (pr.tool === 'gh' && facts.requireLabels && pr.labels.length === 0) {
    const known = facts.availableLabels.length > 0 ? ` Labels in this repo: ${facts.availableLabels.join(', ')}.` : ''
    problems.push(`This repo labels every PR: pass --label for every label that fits (a kind, each area it touches, any handling flag).${known}`)
  }

  return problems.length === 0 ? null : `pr-rules: ${problems.join(' ')}`
}

const LABEL_RULE = /label every (issue and )?pr\b/i

const git = async ($: EngineInterface, cwd: string, args: string[]) => {
  const run = await $.process.run(['git', ...args], { cwd, timeoutMs: 15_000 })
  if (run.exitCode !== 0) throw new Error(`git ${args[0]} failed`)

  return run.stdout.trim()
}

const resolveDir = async ($: EngineInterface, dir: string | undefined) => {
  const cwd = await $.session.cwd()
  if (dir === undefined) return cwd
  if (dir.startsWith('/')) return dir
  if (dir.startsWith('~')) return `${(await $.env.get('HOME')) ?? ''}${dir.slice(1)}`

  return `${cwd}/${dir}`
}

const defaultBranch = async ($: EngineInterface, root: string) => {
  const head = await git($, root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).catch(() => '')
  if (head !== '') return head
  for (const name of ['origin/main', 'origin/master']) {
    if ((await git($, root, ['rev-parse', '--verify', '--quiet', name]).catch(() => '')) !== '') return name
  }

  return null
}

export type Mode = 'auto' | 'on' | 'off'

// A per-repo switch kept across sessions: off skips the repo, on also
// requires labels there, auto (no entry) goes by what the repo contains.
const modeKey = (root: string) => `mode:${root}`

const modeOf = async ($: EngineInterface, root: string): Promise<Mode> => {
  const stored = await $.store.get(modeKey(root)).catch(() => undefined)

  return stored === 'on' || stored === 'off' ? stored : 'auto'
}

const gatherFacts = async ($: EngineInterface, pr: PrCommand, requireLabelsOption: boolean): Promise<RepoFacts | null> => {
  const root = await git($, await resolveDir($, pr.cd), ['rev-parse', '--show-toplevel'])
  const mode = await modeOf($, root)
  if (mode === 'off') {
    return null
  }

  const changelogs: string[] = []
  for (const entry of await $.fs.list(root)) {
    if (entry.kind === 'file' && /^CHANGELOG.*\.md$/i.test(entry.name)) {
      const text = await $.fs.read(`${root}/${entry.name}`)
      if (/^##\s*\[Unreleased\]/im.test(text)) changelogs.push(entry.name)
    }
  }

  const claudeMd = (await $.fs.exists(`${root}/CLAUDE.md`)) ? await $.fs.read(`${root}/CLAUDE.md`) : ''
  const requireLabels = mode === 'on' || requireLabelsOption || LABEL_RULE.test(claudeMd)
  if (changelogs.length === 0 && !requireLabels) {
    return null
  }

  const base = await defaultBranch($, root)
  if (base === null) {
    return null
  }
  const mergeBase = await git($, root, ['merge-base', 'HEAD', base])
  const changed = (await git($, root, ['diff', '--name-only', mergeBase, 'HEAD'])).split('\n').filter(Boolean)

  let availableLabels: string[] = []
  if (requireLabels && pr.tool === 'gh' && pr.labels.length === 0) {
    const run = await $.process.run(['gh', 'label', 'list', '--json', 'name', '--limit', '100'], { cwd: root, timeoutMs: 15_000 }).catch(() => undefined)
    if (run?.exitCode === 0) {
      availableLabels = (JSON.parse(run.stdout) as { name: string }[]).map(label => label.name)
    }
  }

  return { changelogs, changed, requireLabels, availableLabels }
}

export const register: Register = (on, options) => {
  const requireLabelsOption = options.requireLabels === true

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'pr-rules', description: 'PR rules for this repo: /pr-rules [on|off|auto]' })

    return next(e)
  })

  on('command.run', { command: 'pr-rules' }, async ($, e) => {
    const root = await git($, await $.session.root(), ['rev-parse', '--show-toplevel']).catch(() => null)
    if (root === null) {
      return { text: 'Not in a git repo.' }
    }

    const wanted = e.args.trim()
    if (wanted === 'on' || wanted === 'off') {
      await $.store.set(modeKey(root), wanted)
    } else if (wanted === 'auto') {
      await $.store.delete(modeKey(root))
    } else if (wanted !== '') {
      return { text: 'Usage: /pr-rules [on|off|auto]' }
    }

    const mode = await modeOf($, root)
    const changelogs: string[] = []
    for (const entry of await $.fs.list(root)) {
      if (entry.kind === 'file' && /^CHANGELOG.*\.md$/i.test(entry.name) && /^##\s*\[Unreleased\]/im.test(await $.fs.read(`${root}/${entry.name}`))) {
        changelogs.push(entry.name)
      }
    }
    const claudeMd = (await $.fs.exists(`${root}/CLAUDE.md`)) ? await $.fs.read(`${root}/CLAUDE.md`) : ''
    const labels = mode === 'on' ? 'on (/pr-rules on)' : requireLabelsOption ? 'on (requireLabels setting)' : LABEL_RULE.test(claudeMd) ? 'on (CLAUDE.md asks for labels)' : 'off'

    return {
      text: mode === 'off'
        ? `PR rules are off for ${root}. /pr-rules auto turns them back on.`
        : [
            `PR rules for ${root} (${mode}):`,
            `  changelog: ${changelogs.length > 0 ? `on (${changelogs.join(', ')})` : 'off (no CHANGELOG with [Unreleased])'}`,
            `  labels:    ${labels}`,
          ].join('\n'),
    }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const pr = parsePrCommand(e.command)
    if (pr === null) {
      return next(e)
    }

    // Any failure reading the repo lets the command through.
    const facts = await gatherFacts($, pr, requireLabelsOption).catch(() => null)
    const reason = facts === null ? null : decide(pr, facts)

    return reason === null ? next(e) : { deny: reason }
  })
}
