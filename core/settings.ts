import { parseHours } from './hours'
import { DEFAULT_STYLE_HINT } from './style'

export const defaultSettings = {
  activeHours: '10:00-13:00, 19:00-24:00',
  idleMinutes: 45,
  dailyProactive: 3,
  minProactiveGapMinutes: 120,
  probeWaitMinutes: 12,
  followUpOnce: true,
  exitLine: true,
  extractEvery: 20,
  extractWindow: 40,
  connectionId: '',
  model: '',
  maxMembers: 60,
  injectTime: true,
  injectTopics: true,
  injectMembers: true,
  injectThoughts: true,
  memberTools: true,
  slangLearning: true,
  slangScanDepth: 10,
  styleHint: DEFAULT_STYLE_HINT,
  injectStyle: true,
}
export type Settings = typeof defaultSettings
export const starred = [
  'activeHours',
  'idleMinutes',
  'dailyProactive',
  'minProactiveGapMinutes',
  'probeWaitMinutes',
  'followUpOnce',
  'exitLine',
] as const
export type Overrides = Partial<Pick<Settings, (typeof starred)[number]>>
export const ranges: Partial<Record<keyof Settings, readonly [number, number]>> = {
  idleMinutes: [5, 1440],
  dailyProactive: [0, 20],
  minProactiveGapMinutes: [10, 1440],
  probeWaitMinutes: [2, 120],
  extractEvery: [5, 200],
  extractWindow: [10, 200],
  maxMembers: [1, 1000],
  slangScanDepth: [1, 50],
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_INPUT')
  return value as Record<string, unknown>
}
export function keys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error('INVALID_INPUT')
}
export function text(value: unknown, max = 1000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('INVALID_INPUT')
  return value.trim()
}
function valid(key: keyof Settings, value: unknown): boolean {
  if (typeof value !== typeof defaultSettings[key]) return false
  if (key === 'activeHours') return parseHours(String(value)) !== null
  const range = ranges[key]
  if (range) return typeof value === 'number' && Number.isInteger(value) && value >= range[0] && value <= range[1]
  return typeof value !== 'string' || value.length <= 10000
}
export function overrides(value: unknown): Overrides {
  const row = object(value)
  keys(row, starred)
  for (const [key, value] of Object.entries(row))
    if (!valid(key as keyof Settings, value)) throw new Error('INVALID_INPUT')
  return row as Overrides
}
export function settings(value: Record<string, unknown>, override: Overrides = {}): Settings {
  const result = { ...defaultSettings }
  for (const key of Object.keys(result) as (keyof Settings)[]) {
    if (valid(key, value[key])) Object.assign(result, { [key]: value[key] })
  }
  return { ...result, ...override }
}
export function defaults(value: Settings): Overrides {
  return Object.fromEntries(starred.map((key) => [key, value[key]])) as Overrides
}
