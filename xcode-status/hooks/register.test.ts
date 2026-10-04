import { expect, test } from 'claude-code/testing'

import { ago, findXcodeProject, parseBooted, parseResult } from './register'

const dir = (name: string) => ({ name, kind: 'dir' as const })
const file = (name: string) => ({ name, kind: 'file' as const })

test('only a real Xcode project counts', async () => {
  expect(findXcodeProject([dir('Stenobar.xcodeproj'), dir('Sources')])).toBe('Stenobar')
  expect(findXcodeProject([dir('App.xcodeproj'), dir('App.xcworkspace')])).toBe('App')
  expect(findXcodeProject([dir('ios')], { ios: [dir('Runner.xcworkspace')] })).toBe('Runner')
  expect(findXcodeProject([file('Package.swift'), dir('Sources')])).toBe(null)
  expect(findXcodeProject([file('fake.xcodeproj')])).toBe(null)
  expect(findXcodeProject([file('package.json')])).toBe(null)
})

test('parses build and test results', async () => {
  const failed = 'a.swift:10:5: error: x\na.swift:10:5: error: x\nb.swift:2:1: error: y\n** BUILD FAILED **'
  expect(parseResult(failed, 'xcodebuild -scheme Stenobar build')).toEqual({ kind: 'build', ok: false, errors: 2, scheme: 'Stenobar', tests: undefined, failures: undefined })

  const xctest = 'Executed 42 tests, with 1 failure (0 unexpected)\n** TEST FAILED **'
  expect(parseResult(xctest, 'xcodebuild test')).toMatchObject({ kind: 'test', ok: false, tests: 42, failures: 1 })

  const zero = 'Executed 0 tests, with 0 failures\n** TEST SUCCEEDED **'
  expect(parseResult(zero, 'xcodebuild test -only-testing:X/y')).toMatchObject({ kind: 'test', ok: true, tests: 0 })

  const swift = '✔ Test run with 12 tests in 3 suites passed after 0.4 seconds.\n** TEST SUCCEEDED **'
  expect(parseResult(swift, './scripts/test.sh')).toMatchObject({ tests: 12, failures: 0 })

  expect(parseResult('Compiling...', 'xcodebuild build')).toBe(null)
})

test('reads booted simulators', async () => {
  const json = JSON.stringify({ devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-18-2': [{ name: 'iPhone 16 Pro', state: 'Booted' }, { name: 'iPad', state: 'Shutdown' }],
  } })
  expect(parseBooted(json)).toBe('iPhone 16 Pro (iOS 18.2)')
  expect(parseBooted(JSON.stringify({ devices: { x: [] } }))).toBe(null)
})

test('formats age', async () => {
  expect(ago(20_000)).toBe('just now')
  expect(ago(5 * 60_000)).toBe('5m ago')
})
