import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BuildResult } from '../types'

const project = atom({ plugin: 'xcode-status', key: 'project' } as const, null as string | null)
const root = atom({ plugin: 'xcode-status', key: 'root' } as const, null as string | null)
// Last result per project root, so moving away and back keeps it.
const results = atom({ plugin: 'xcode-status', key: 'results' } as const, {} as Record<string, BuildResult>)
const simulator = atom({ plugin: 'xcode-status', key: 'simulator' } as const, null as string | null)
const tick = atom({ plugin: 'xcode-status', key: 'tick' } as const, 0)

const POLL_MS = 30_000
const SKIP_DIRS = new Set(['Pods', 'node_modules', 'DerivedData', '.build', 'build', 'Carthage', '.git'])
const XCODE_CONTAINER = /\.(xcodeproj|xcworkspace)$/

type Entry = { name: string; kind: 'file' | 'dir' | 'other' }

// The project's name when `entries` (the root) or one folder below holds an
// .xcodeproj or .xcworkspace; null otherwise. A workspace wins over a project.
export const findXcodeProject = (root: readonly Entry[], children: Record<string, readonly Entry[]> = {}) => {
  const pick = (entries: readonly Entry[]) => {
    const found = entries.filter(entry => entry.kind === 'dir' && XCODE_CONTAINER.test(entry.name))
    const best = found.find(entry => entry.name.endsWith('.xcworkspace')) ?? found[0]

    return best?.name.replace(XCODE_CONTAINER, '') ?? null
  }

  return pick(root) ?? Object.values(children).map(pick).find(name => name !== null) ?? null
}

// What a run of xcodebuild (or a script wrapping it) printed: null when the
// output carries none of xcodebuild's own result markers.
export const parseResult = (output: string, command: string): Omit<BuildResult, 'at' | 'durationMs'> | null => {
  const marker = output.match(/\*\* (BUILD|TEST|ANALYZE|ARCHIVE|CLEAN) (SUCCEEDED|FAILED|INTERRUPTED) \*\*/g)?.at(-1)
  if (marker === undefined) {
    return null
  }

  const kind = marker.includes('TEST') ? 'test' : 'build'
  const ok = marker.includes('SUCCEEDED')
  const errors = new Set(output.match(/^.*:\d+:\d+: error: .*$/gm) ?? []).size
  const scheme = command.match(/-scheme\s+("[^"]+"|'[^']+'|\S+)/)?.[1]?.replace(/^["']|["']$/g, '')

  // XCTest: "Executed 42 tests, with 1 failure". Swift Testing: "Test run with 42 tests ... passed/failed ... 3 issues".
  const xctest = [...output.matchAll(/Executed (\d+) tests?, with (\d+) failures?/g)].at(-1)
  const swiftTesting = [...output.matchAll(/Test run with (\d+) tests?[^\n]*?(passed|failed)(?:[^\n]*?with (\d+) issues?)?/g)].at(-1)
  let tests: number | undefined
  let failures: number | undefined
  if (xctest !== undefined) {
    tests = Number(xctest[1])
    failures = Number(xctest[2])
  }
  if (swiftTesting !== undefined) {
    tests = (tests ?? 0) + Number(swiftTesting[1])
    failures = (failures ?? 0) + (swiftTesting[2] === 'failed' ? Number(swiftTesting[3] ?? 1) : 0)
  }
  if (kind === 'test' && tests === undefined && /Executed 0 tests|Test run with 0 tests/.test(output)) {
    tests = 0
  }

  return { kind, ok, errors, scheme, tests, failures }
}

// "iPhone 16 Pro (iOS 18.2)" for each booted device in `simctl list -j`.
export const parseBooted = (json: string): string | null => {
  const data = JSON.parse(json) as { devices: Record<string, { name: string; state: string }[]> }
  const booted = Object.entries(data.devices).flatMap(([runtime, devices]) =>
    devices
      .filter(device => device.state === 'Booted')
      .map(device => {
        const os = runtime.match(/SimRuntime\.(\w+)-(\d+)-(\d+)/)

        return os === null ? device.name : `${device.name} (${os[1]} ${os[2]}.${os[3]})`
      }),
  )

  return booted.length === 0 ? null : booted.length === 1 ? (booted[0] ?? null) : `${booted[0]} +${booted.length - 1}`
}

export const ago = (ms: number) => {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`

  return `${Math.floor(minutes / 60)}h ago`
}

const detect = async ($: EngineInterface) => {
  const dir = await $.session.root()
  const entries = await $.fs.list(dir)
  const children: Record<string, Entry[]> = {}
  if (findXcodeProject(entries) === null) {
    for (const entry of entries) {
      if (entry.kind === 'dir' && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        children[entry.name] = await $.fs.list(`${dir}/${entry.name}`).catch(() => [])
      }
    }
  }
  const name = findXcodeProject(entries, children)
  await update($, project, () => name)
  await update($, root, () => (name === null ? null : dir))

  return name
}

const pollSimulator = async ($: EngineInterface) => {
  if ((await read($, project)) === null) {
    return
  }
  const run = await $.process.run(['xcrun', 'simctl', 'list', 'devices', 'booted', '-j'], { timeoutMs: 10_000 })
  const booted = run.exitCode === 0 ? parseBooted(run.stdout) : null
  await update($, simulator, () => booted)
  await update($, tick, n => n + 1)
}

const isXcodebuild = (command: string) => /(^|[\s;&|(])xcodebuild\s/.test(command)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    if ((await detect($).catch(() => null)) !== null) {
      pollSimulator($).catch(() => undefined)
    }
    $.clock.every(POLL_MS, () => {
      pollSimulator($).catch(() => undefined)
    })

    return started
  })

  // The root moves with /cd or a worktree switch: look again before each prompt.
  on('prompt.submit', async ($, e, next) => {
    const before = await read($, project)
    const name = await detect($).catch(() => before)
    if (name !== null && name !== before) {
      pollSimulator($).catch(() => undefined)
    }

    return next(e)
  })

  on('command.run', { command: 'cd' }, async ($, e, next) => {
    const moved = await next(e)
    const before = await read($, project)
    const name = await detect($).catch(() => before)
    if (name !== null && name !== before) {
      pollSimulator($).catch(() => undefined)
    }

    return moved
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if ((await read($, project)) === null) {
      return next(e)
    }

    // Parallel builds and simulators once froze the Mac for 30+ minutes.
    if (isXcodebuild(e.command)) {
      const running = await $.process.run(['pgrep', '-x', 'xcodebuild']).catch(() => undefined)
      if (running?.exitCode === 0) {
        return {
          deny: 'xcode-status: another xcodebuild is already running (a subagent or a background run). Builds and tests must be serialized: wait for it to finish, then run this.',
        }
      }
    }

    const startedAt = await $.clock.now()
    const ran = await next(e)
    if (ran.deny !== undefined) {
      return ran
    }

    const result = parseResult(ran.text ?? '', e.command)
    const dir = await read($, root)
    if (result !== null && dir !== null) {
      const at = await $.clock.now()
      await update($, results, all => ({ ...all, [dir]: { ...result, at, durationMs: at - startedAt } }))
    }
    if (/\bsimctl\s+(boot|shutdown|erase)\b/.test(e.command)) {
      await pollSimulator($)
    }

    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const name = await read($, project)
    if (name === null || e.props.hasSurvey) {
      return below
    }

    await read($, tick)
    const dir = await read($, root)
    const build = dir === null ? null : ((await read($, results))[dir] ?? null)
    const sim = await read($, simulator)
    if (build === null && sim === null) {
      return below
    }

    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const isZeroTests = build?.kind === 'test' && build.tests === 0
    const color = build === null ? undefined : !build.ok ? 'red' : isZeroTests ? 'yellow' : 'green'
    const outcome =
      build === null
        ? ''
        : build.kind === 'test'
          ? build.tests === undefined
            ? `tests ${build.ok ? 'passed' : 'failed'}`
            : isZeroTests
              ? 'ran 0 tests'
              : `${build.tests} tests${build.failures ? `, ${build.failures} failed` : ''}`
          : build.ok
            ? 'built'
            : `build failed${build.errors > 0 ? ` (${build.errors} error${build.errors === 1 ? '' : 's'})` : ''}`

    return (
      <Box flexDirection="column">
        <Box>
          <Text dimColor>{build?.scheme ?? name} </Text>
          {build !== null && <Text color={color}>{build.ok && !isZeroTests ? '✓' : isZeroTests ? '⚠' : '✗'} {outcome}</Text>}
          {build !== null && <Text dimColor> {ago(now - build.at)}</Text>}
          {sim !== null && <Text dimColor>{build !== null ? '  ·  ' : ''}◉ {sim}</Text>}
        </Box>
        {below}
      </Box>
    )
  })
}
