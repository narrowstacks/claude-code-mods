import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Note } from '../types'

// Set once a fresh context starts (a /clear, a new session); the next prompt carries the note.
const armed = atom({ plugin: 'handoff', key: 'armed' } as const, false)

const MAX_AGE_MS = 24 * 60 * 60 * 1000

const PROMPT = `Write a handoff note so a fresh context can continue this work without the transcript. Plain markdown, under 250 words, these headings only:

## Goal
## Decisions and constraints
Every explicit instruction or preference the user gave, verbatim where short.
## Files touched
Paths, one line each on what changed.
## Current state
What works, what is verified, what is broken or unverified.
## Next step
The single next action.

Reply with the note only.`

const noteKey = async ($: EngineInterface) => `note:${await $.session.root()}`

export const readNote = async ($: EngineInterface): Promise<Note | undefined> => {
  const note = (await $.store.get(await noteKey($))) as Note | undefined
  if (note === undefined || (await $.clock.now()) - note.at > MAX_AGE_MS) {
    return undefined
  }

  return note
}

const save = async ($: EngineInterface, focus: string) => {
  const prompt = focus === '' ? PROMPT : `${PROMPT}\n\nThe user wants the note to focus on: ${focus}`
  const reply = await $.model.fork({ prompt })
  if (!reply.isAnswered) {
    return { error: reply.reason === 'nothing-to-fork' ? 'nothing to hand off yet' : `the summary failed (${reply.reason})` }
  }

  const note: Note = { text: reply.text.trim(), at: await $.clock.now() }
  await $.store.set(await noteKey($), note)

  return { note }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'carryover',
      description: 'Save a state note and /clear; the next prompt carries it. Args: [focus] | save | show | drop',
    })
    if ((await readNote($)) !== undefined) {
      await update($, armed, () => true)
    }

    return next(e)
  })

  on('command.run', { command: 'carryover' }, async ($, e) => {
    const args = e.args.trim()

    if (args === 'show') {
      const note = await readNote($)

      return { text: note?.text ?? 'No handoff note for this project.' }
    }
    if (args === 'drop') {
      await $.store.delete(await noteKey($))
      await update($, armed, () => false)

      return { text: 'Handoff note dropped.' }
    }

    const isSaveOnly = args === 'save'
    const saved = await save($, isSaveOnly ? '' : args)
    if ('error' in saved) {
      return { text: `carryover: ${saved.error}.` }
    }
    if (isSaveOnly) {
      return { text: 'Handoff note saved. It rides along with the first prompt after /clear or in a new session here.' }
    }

    $.command.run({ command: 'clear', args: '' }).then(
      () => update($, armed, () => true),
      () => $.ui.toast('Handoff saved. Run /clear to start fresh with it.'),
    )

    return { text: 'Handoff note saved. Clearing; your next prompt carries it.' }
  })

  on('command.run', { command: 'clear' }, async ($, e, next) => {
    const ran = await next(e)
    if ((await readNote($)) !== undefined) {
      await update($, armed, () => true)
    }

    return ran
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer' || !(await read($, armed))) {
      return next(e)
    }

    const note = await readNote($)
    await update($, armed, () => false)
    if (note === undefined) {
      return next(e)
    }

    await $.store.delete(await noteKey($))
    $.ui.toast('Handoff note carried in')

    return next({
      ...e,
      context: [...(e.context ?? []), `Handoff note from the previous context (written before /clear):\n\n${note.text}`],
    })
  })
}
