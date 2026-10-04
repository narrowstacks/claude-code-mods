import type { Register } from 'claude-code'

const GLOB_FLAG = /(^|\s)(--?[\w-]+=)([^\s'"]*[*?[][^\s'"]*)/g
const GLOB_FIND = /(\s-(?:i?name|i?path|i?wholename|regex)\s+)([^\s'"]*[*?[][^\s'"]*)/g
const SEARCHERS = /^(grep|egrep|fgrep|rg)\b/

// Quotes a glob that zsh would expand (and fail on with "no matches found")
// where the command means it literally: a flag's value or find's pattern.
export const quoteGlobs = (command: string) =>
  command
    .replace(GLOB_FLAG, (_, lead: string, flag: string, value: string) => `${lead}${flag}'${value}'`)
    .replace(GLOB_FIND, (_, lead: string, value: string) => `${lead}'${value}'`)

// Where the last top-level command starts and the separator before it,
// skipping quoted text. Null when the command holds something too tricky
// to split safely (a heredoc, a subshell, an existing ||).
export const lastSegment = (command: string): { start: number; separator: string } | null => {
  if (/<<|\$\(|`|\|\|/.test(command)) {
    return null
  }

  let quote: string | null = null
  let start = 0
  let separator = ''
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i]
    if (quote !== null) {
      if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
    } else if (char === '&' && command[i + 1] === '&') {
      start = i + 2
      separator = '&&'
      i += 1
    } else if (char === ';' || char === '\n') {
      start = i + 1
      separator = ';'
    } else if (char === '|') {
      start = i + 1
      separator = '|'
    }
  }

  return { start, separator }
}

// grep exits 1 when nothing matches, which fails a `cd dir && grep ...`
// chain as if it had broken. Exit 1 becomes success; 2 (a real error) stays.
export const tolerateNoMatch = (command: string) => {
  const segment = lastSegment(command)
  if (segment === null || segment.separator === '|') {
    return command
  }

  const tail = command.slice(segment.start)
  const body = tail.trim()
  if (!SEARCHERS.test(body)) {
    return command
  }

  const lead = tail.slice(0, tail.length - tail.trimStart().length)

  return `${command.slice(0, segment.start)}${lead}{ ${body.replace(/;\s*$/, '')} || [ $? -eq 1 ]; }`
}

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, ($, e, next) => {
    const command = tolerateNoMatch(quoteGlobs(e.command))

    return next(command === e.command ? e : { ...e, command })
  })
}
