import type { ExtensionStorage } from '../../../apps/server/src/extensions/types'
import type { Memory } from './memory'
import { capMembers, emptyMemory, parseMemoryPatch } from './memory'
import type { Overrides } from './settings'
import { object, overrides } from './settings'
import type { Glossary } from './slang'
import { parseEntry } from './slang'
import type { State } from './state'
import { initialState } from './state'

export interface ChatConfig {
  enabled: boolean
  overrides: Overrides
}
export class Store {
  constructor(readonly storage: ExtensionStorage) {}
  private read<T>(key: string, parse: (value: unknown) => T, fallback: () => T): T {
    try {
      return parse(this.storage.get(key))
    } catch {
      return fallback()
    }
  }
  chats(): string[] {
    return this.read(
      'chats',
      (value) => {
        if (!Array.isArray(value) || !value.every((id) => typeof id === 'string' && id.length > 0))
          throw new Error('INVALID_INPUT')
        return [...new Set(value)]
      },
      () => [],
    )
  }
  chat(id: string): ChatConfig {
    return this.read<ChatConfig>(
      `chat:${id}`,
      (value) => {
        const row = object(value)
        if (typeof row.enabled !== 'boolean') throw new Error('INVALID_INPUT')
        return { enabled: row.enabled, overrides: overrides(row.overrides) }
      },
      () => ({ enabled: false, overrides: {} }),
    )
  }
  saveChat(id: string, config: ChatConfig) {
    this.storage.set(`chat:${id}`, config)
    this.storage.set('chats', [...this.chats().filter((chat) => chat !== id), ...(config.enabled ? [id] : [])])
  }
  state(id: string, now: number): State {
    return this.read(
      `state:${id}`,
      (value) => {
        const row = object(value)
        const fallback = initialState(now)
        if (
          !['lurking', 'active', 'probing', 'exiting'].includes(String(row.phase)) ||
          typeof row.proactiveDate !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(row.proactiveDate) ||
          typeof row.followUpDone !== 'boolean'
        )
          throw new Error('INVALID_INPUT')
        for (const key of [
          'since',
          'lastHumanAt',
          'lastAiAt',
          'lastProactiveAt',
          'proactiveCount',
          'probeStartedAt',
          'sinceExtract',
        ] as const) {
          const number = row[key]
          if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || !Number.isInteger(number))
            throw new Error('INVALID_INPUT')
        }
        if (row.pendingProactive !== undefined && !['probe', 'followup', 'exit'].includes(String(row.pendingProactive)))
          throw new Error('INVALID_INPUT')
        return { ...fallback, ...row } as State
      },
      () => initialState(now),
    )
  }
  saveState(id: string, state: State) {
    this.storage.set(`state:${id}`, state)
  }
  memory(id: string, maxMembers: number): Memory {
    return this.read(
      `memory:${id}`,
      (value) => {
        const memory = { ...emptyMemory(), ...parseMemoryPatch(value, 1000) }
        return { ...memory, members: capMembers(memory.members, maxMembers) }
      },
      emptyMemory,
    )
  }
  saveMemory(id: string, memory: Memory) {
    this.storage.set(`memory:${id}`, memory)
  }
  slang(): Glossary {
    return this.read(
      'slang',
      (value) => {
        const row = object(value)
        if (!Array.isArray(row.entries)) throw new Error('INVALID_INPUT')
        return { entries: row.entries.map(parseEntry) }
      },
      () => ({ entries: [] }),
    )
  }
  saveSlang(glossary: Glossary) {
    this.storage.set('slang', glossary)
  }
}
