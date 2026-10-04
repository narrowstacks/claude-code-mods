import { expect, test } from 'claude-code/testing'

import { parseCommand, verdict } from './register'

test('finds programs and the leading cd', async () => {
  expect(parseCommand('cd ~/app && CI=1 npx vitest run')).toEqual({ programs: ['cd', 'npx'], cd: '~/app' })
  expect(parseCommand('git pull && pnpm install')).toEqual({ programs: ['git', 'pnpm'], cd: undefined })
})

test('steers to the lockfile manager', async () => {
  expect(verdict('npm', 'npx', 'bun')).toContain('Use bunx instead of npx')
  expect(verdict('npm', 'npm', 'pnpm')).toContain('Use pnpm instead of npm')
  expect(verdict('pnpm', 'pnpm', 'pnpm')).toBe(null)
  expect(verdict('npm', 'npm', 'npm')).toBe(null)
  expect(verdict('npm', 'npx', null)).toContain('Use bunx instead of npx')
  expect(verdict('bun', 'bun', null)).toBe(null)
})
