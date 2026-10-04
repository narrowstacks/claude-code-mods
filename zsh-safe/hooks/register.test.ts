import { expect, test } from 'claude-code/testing'

import { quoteGlobs, tolerateNoMatch } from './register'

test('quotes globs zsh would expand', async () => {
  expect(quoteGlobs('grep -rn foo --include=*.swift src')).toBe("grep -rn foo --include='*.swift' src")
  expect(quoteGlobs('find . -name *.ts -type f')).toBe("find . -name '*.ts' -type f")
  expect(quoteGlobs("grep --include='*.ts' x")).toBe("grep --include='*.ts' x")
  expect(quoteGlobs('ls src/*.ts')).toBe('ls src/*.ts')
})

test('a grep that finds nothing does not fail the chain', async () => {
  expect(tolerateNoMatch('cd app && grep -rn foo src')).toBe('cd app && { grep -rn foo src || [ $? -eq 1 ]; }')
  expect(tolerateNoMatch('cd app; rg foo')).toBe('cd app; { rg foo || [ $? -eq 1 ]; }')
  expect(tolerateNoMatch("grep 'a;b' file")).toBe("{ grep 'a;b' file || [ $? -eq 1 ]; }")
  expect(tolerateNoMatch('grep foo x | head')).toBe('grep foo x | head')
  expect(tolerateNoMatch('grep foo x || echo none')).toBe('grep foo x || echo none')
  expect(tolerateNoMatch('cd app && bun test')).toBe('cd app && bun test')
})

test('rewrites the command the tool runs', async ($, on) => {
  let ran = ''
  on('tool.call', (_t, e) => {
    ran = 'command' in e ? String(e.command) : ''

    return { result: { stdout: '', stderr: '', interrupted: false } as never }
  })
  await $.tool.call({ tool: 'Bash', command: 'cd x && grep -rn y --include=*.ts' })
  expect(ran).toBe("cd x && { grep -rn y --include='*.ts' || [ $? -eq 1 ]; }")
})
