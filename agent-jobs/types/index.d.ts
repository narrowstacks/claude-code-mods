export type JobStatus = 'running' | 'completed' | 'failed' | 'killed'

export type Job = {
  id: string
  kind: 'agent' | 'shell'
  label: string
  detail?: string
  startedAt: number
  endedAt?: number
  status: JobStatus
  isBackground: boolean
  stopId: string
  /** What the agent did last, newest last; the last entry is what it is doing now. */
  recent?: string[]
  /** The first line of a finished agent's answer. */
  outcome?: string
}

declare module 'claude-code' {
  interface PluginState {
    'agent-jobs': { jobs: Job[]; now: number; expanded: string | null }
  }
}
