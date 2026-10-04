import { expect, test } from 'claude-code/testing'

test('adds the rule to the system prompt', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'hi', scope: 'shared' as const }] }))
  const { sections } = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] })
  expect(sections.at(-1)?.id).toBe('house-style:em-dash')
})

test('reminds the model after a write that adds an em dash', async ($, on) => {
  on('tool.call', () => ({ result: { filePath: '/r/README.md' } as never }))
  const ran = await $.tool.call({ tool: 'Write', file_path: '/r/README.md', content: 'Fast — and small' })
  expect(ran.context?.join(' ')).toContain('1 em dash')

  const clean = await $.tool.call({ tool: 'Write', file_path: '/r/README.md', content: 'Fast, and small' })
  expect(clean.context ?? []).toEqual([])
})
