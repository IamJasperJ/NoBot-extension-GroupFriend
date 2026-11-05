import type { Memory } from './core/memory'
import type { Overrides, Settings } from './core/settings'
import type { State } from './core/state'

export interface ChatListItem {
  chatId: string
  title: string
  enabled: boolean
  phase: State['phase']
  proactiveToday: number
  dailyProactive: number
  nextProbeAt: number | null
  lastHumanAt: number
  inActiveHours: boolean
}
export interface ChatDetail {
  chatId: string
  title: string
  enabled: boolean
  overrides: Overrides
  defaults: Overrides
  effective: Settings
  state: State
  memory: Memory
  nextProbeAt: number | null
  inActiveHours: boolean
}
export interface Option {
  value: string
  label: string
}
export interface ErrorResponse {
  error: { code: string; message: string }
}
