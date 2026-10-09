import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TrackedPr, Verdict } from '../types'

const prs = atom({ plugin: 'pr-watch', key: 'prs' } as const, [] as TrackedPr[])
const isHidden = atom({ plugin: 'pr-watch', key: 'isHidden' } as const, false)

const POLL_MS = 60_000
const GITHUB_PR = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g
const GRAPHITE_PR = /https:\/\/app\.graphite\.(?:dev|com)\/github\/pr\/([\w.-]+)\/([\w.-]+)\/(\d+)/g

// Foreground loops that block the turn waiting on CI or a merge.
const POLL_LOOP = [
  /\bgh\s+(pr\s+checks|run\s+watch)\b[^|;&]*--watch\b/,
  /\bgh\s+run\s+watch\b/,
  /\b(while|until|for)\b[\s\S]*\bgh\s+(pr|run)\s+(view|checks|list)\b[\s\S]*\bsleep\s+\d+/,
  /\bsleep\s+\d{2,}\s*(;|&&)\s*gh\s+(pr|run)\b/,
]

export const findPrUrls = (text: string): string[] => {
  const urls = new Set<string>()
  for (const pattern of [GITHUB_PR, GRAPHITE_PR]) {
    for (const [, owner, repo, number] of text.matchAll(pattern)) {
      urls.add(`https://github.com/${owner}/${repo}/pull/${number}`)
    }
  }

  return [...urls]
}

export const isPollLoop = (command: string) => POLL_LOOP.some(pattern => pattern.test(command))

type Check = { conclusion?: string | null; state?: string | null; status?: string | null; name?: string; context?: string }

export const summarize = (checks: readonly Check[]) => {
  let passed = 0
  let failed = 0
  let pending = 0
  const failing: string[] = []
  for (const check of checks) {
    const outcome = (check.conclusion || check.state || '').toUpperCase()
    if (check.status !== undefined && check.status !== null && check.status.toUpperCase() !== 'COMPLETED') {
      pending += 1
    } else if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(outcome)) {
      passed += 1
    } else if (['PENDING', 'EXPECTED', 'QUEUED', 'IN_PROGRESS', ''].includes(outcome)) {
      pending += 1
    } else {
      failed += 1
      failing.push(check.name || check.context || 'unnamed check')
    }
  }
  const verdict: Verdict =
    failed > 0 ? 'failing' : pending > 0 ? 'pending' : passed > 0 ? 'passing' : 'none'

  return { passed, failed, pending, verdict, failing }
}

// https://github.com/<owner>/<repo>/pull/<number>
export const labelOf = (url: string) => {
  const [, , , , repo, , number] = url.split('/')

  return `${repo}#${number}`
}

const fetchPr = async ($: EngineInterface, pr: TrackedPr): Promise<TrackedPr> => {
  const view = await $.process.run(
    ['gh', 'pr', 'view', pr.url, '--json', 'title,state,statusCheckRollup'],
    { timeoutMs: 20_000 },
  )
  if (view.exitCode !== 0) {
    return pr
  }

  const data = JSON.parse(view.stdout) as { title: string; state: TrackedPr['state']; statusCheckRollup: Check[] }

  return { ...pr, title: data.title, state: data.state, ...summarize(data.statusCheckRollup ?? []) }
}

const announce = ($: EngineInterface, before: TrackedPr, after: TrackedPr) => {
  if (before.state !== after.state && after.state !== 'OPEN') {
    $.ui.toast(`${labelOf(after.url)} ${after.state.toLowerCase()}`, { timeoutMs: 10_000 })
  } else if (before.verdict !== after.verdict && after.verdict === 'failing') {
    $.ui.toast(`${labelOf(after.url)}: ${after.failed} check${after.failed === 1 ? '' : 's'} failing`, { timeoutMs: 10_000 })
  } else if (before.verdict !== after.verdict && after.verdict === 'passing') {
    $.ui.toast(`${labelOf(after.url)}: all checks green`, { timeoutMs: 10_000 })
  }
}

const poll = async ($: EngineInterface) => {
  const list = await read($, prs)
  const open = list.filter(pr => pr.state === 'OPEN' || pr.state === 'UNKNOWN')
  for (const pr of open) {
    const fresh = await fetchPr($, pr).catch(() => pr)
    announce($, pr, fresh)
    await update($, prs, all => all.map(one => (one.url === fresh.url ? fresh : one)))
  }
}

const track = async ($: EngineInterface, urls: string[]) => {
  const known = new Set((await read($, prs)).map(pr => pr.url))
  const added = urls.filter(url => !known.has(url))
  if (added.length === 0) {
    return
  }

  const fresh: TrackedPr[] = added.map(url => ({
    url, title: '', state: 'UNKNOWN', verdict: 'none', passed: 0, failed: 0, pending: 0,
  }))
  await update($, prs, all => [...all, ...fresh].slice(-8))
  await update($, isHidden, () => false)
  poll($).catch(() => undefined)
}

// Svg draws as an isolated image, so it takes fixed colors that read on light and dark alike.
const DOT_HEX = { merged: '#a371f7', closed: '#8b949e', passing: '#3fb950', failing: '#f85149', pending: '#d29922' }

const dotOf = (pr: TrackedPr) =>
  pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'closed' : pr.verdict === 'failing' ? 'failing' : pr.verdict === 'passing' ? 'passing' : 'pending'

// A filled dot for a settled PR, a ring while checks are still running.
export const dotSvg = (pr: TrackedPr) => {
  const kind = dotOf(pr)
  const color = DOT_HEX[kind]
  const shape = kind === 'pending'
    ? `<circle cx="5" cy="5" r="3.5" fill="none" stroke="${color}" stroke-width="2"/>`
    : `<circle cx="5" cy="5" r="4.5" fill="${color}"/>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10">${shape}</svg>`
}

const countOf = (pr: TrackedPr) =>
  pr.state === 'OPEN' || pr.state === 'UNKNOWN' ? `${pr.passed}/${pr.passed + pr.failed + pr.pending}` : pr.state.toLowerCase()

const MARK: Record<Verdict, string> = { passing: 'ok', failing: 'FAIL', pending: '...', none: '-' }

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'prs', description: 'Tracked PRs and their checks. /prs add <url> | /prs clear' })
    $.clock.every(POLL_MS, () => {
      poll($).catch(() => undefined)
    })

    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (e.run_in_background !== true && isPollLoop(e.command)) {
      const tracked = (await read($, prs)).map(pr => labelOf(pr.url))
      const watching = tracked.length > 0 ? ` It is tracking ${tracked.join(', ')}.` : ''

      return {
        deny: `pr-watch: don't block the turn polling CI or merge state. The pr-watch mod polls tracked PRs every minute and notifies the user on green, red or merged.${watching} If you must wait on it, rerun with run_in_background: true (or use Monitor) and keep working.`,
      }
    }

    const ran = await next(e)
    const urls = findPrUrls(`${e.command}\n${ran.text ?? ''}`)
    if (urls.length > 0 && /\b(gh\s+pr\s+(create|view|checks|merge|ready)|gt\s+(submit|ss|merge)|git\s+push)\b/.test(e.command)) {
      await track($, urls)
    }

    return ran
  })

  on('command.run', { command: 'prs' }, async ($, e) => {
    const [verb, ...rest] = e.args.trim().split(/\s+/)
    if (verb === 'clear') {
      await update($, prs, () => [])

      return { text: 'Stopped tracking all PRs.' }
    }
    if (verb === 'add') {
      const urls = findPrUrls(rest.join(' '))
      await track($, urls)

      return { text: urls.length > 0 ? `Tracking ${urls.map(labelOf).join(', ')}.` : 'No PR URL found.' }
    }

    await poll($)
    const list = await read($, prs)
    await update($, isHidden, () => false)
    if (list.length === 0) {
      return { text: 'No PRs tracked. They are picked up from gh pr / gt submit / git push output, or /prs add <url>.' }
    }

    return {
      text: list
        .map(pr => `${labelOf(pr.url).padEnd(24)} ${pr.state.padEnd(7)} ${MARK[pr.verdict].padEnd(5)} ${pr.passed} ok, ${pr.failed} fail, ${pr.pending} pending  ${pr.title}`)
        .join('\n'),
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, prs)
    if (e.props.hasSurvey || list.length === 0 || (await read($, isHidden))) {
      return next(e)
    }

    if (e.surface === 'desktop') {
      const { Box, Text, Button, Link, Svg } = $.ui.resolve(e)
      const failingOf = (pr: TrackedPr) => (pr.failing ?? []).slice(0, 3).join(', ') + ((pr.failing?.length ?? 0) > 3 ? ` +${(pr.failing?.length ?? 0) - 3}` : '')

      return (
        <Box alignItems="center" columnGap={2}>
          <Text dimColor>PRs</Text>
          {list.slice(-4).map(pr => (
            <Box key={`pr-${labelOf(pr.url)}`} alignItems="center" columnGap={1}>
              <Svg source={dotSvg(pr)} alt={dotOf(pr)} width={10} height={10} />
              <Link href={pr.url} label={labelOf(pr.url)} />
              <Text dimColor>{countOf(pr)}</Text>
              <Box display="none" hover={{ display: 'flex' }} columnGap={1}>
                {pr.title !== '' ? <Text dimColor>{pr.title}</Text> : null}
                {pr.failed > 0 && failingOf(pr) !== '' ? <Text color="red">failing: {failingOf(pr)}</Text> : null}
              </Box>
            </Box>
          ))}
          <Button key="hide" label="Hide" role="dismiss" onPress={() => update($, isHidden, () => true)} />
        </Box>
      )
    }

    const { Box, Text, Button } = $.ui.resolve(e)
    const colorOf = (pr: TrackedPr) =>
      pr.state === 'MERGED' ? 'magenta' : pr.verdict === 'failing' ? 'red' : pr.verdict === 'passing' ? 'green' : 'yellow'

    return (
      <Box>
        <Text dimColor>PRs </Text>
        {list.slice(-4).map(pr => (
          <Text color={colorOf(pr)}>
            {labelOf(pr.url)} {countOf(pr)}{'  '}
          </Text>
        ))}
        <Button key="hide" label="Hide" onPress={() => update($, isHidden, () => true)} />
      </Box>
    )
  })
}
