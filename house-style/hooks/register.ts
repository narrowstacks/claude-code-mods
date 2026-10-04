import type { Register } from 'claude-code'

const EM_DASH = /—/g

const RULE = [
  'House style (strict): never write the em dash character (U+2014) anywhere: replies, docs, commit messages, PR bodies, code comments, agent instructions.',
  'Use a comma, colon, parentheses, a period, or " - " instead. Check your text for it before sending.',
].join(' ')

export const countEmDashes = (text: string) => text.match(EM_DASH)?.length ?? 0

const writtenText = (input: object): string => {
  const record = input as Record<string, unknown>
  const parts = [record.content, record.new_string, record.new_source]

  return parts.filter((part): part is string => typeof part === 'string').join('\n')
}

export const register: Register = on => {
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return {
      sections: [...composed.sections, { id: 'house-style:em-dash', text: RULE, scope: 'session' as const }],
    }
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const isWrite = e.tool === 'Write' || e.tool === 'Edit' || e.tool === 'NotebookEdit'
    if (!isWrite || ran.deny !== undefined || ran.isError === true) {
      return ran
    }

    const count = countEmDashes(writtenText(e))
    if (count === 0) {
      return ran
    }

    const where = 'file_path' in e && typeof e.file_path === 'string' ? e.file_path : 'the file'
    const note = `house-style: that write added ${count} em dash${count === 1 ? '' : 'es'} to ${where}. The user forbids em dashes in docs and comments; replace them unless they are part of data the user asked to preserve.`

    return { ...ran, context: [...(ran.context ?? []), note] }
  })

  on('turn.complete', async ($, e, next) => {
    const count = e.agentId === undefined ? countEmDashes(e.answer) : 0
    if (count > 0) {
      $.ui.toast(`house-style: reply used ${count} em dash${count === 1 ? '' : 'es'}`)
    }

    return next(e)
  })
}
