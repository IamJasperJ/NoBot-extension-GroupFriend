import { dailyHours, inHours, localDate } from './hours'
import type { Settings } from './settings'

export type Action = 'probe' | 'followup' | 'exit'
export interface State {
  phase: 'lurking' | 'active' | 'probing' | 'exiting'
  since: number
  lastHumanAt: number
  lastAiAt: number
  lastProactiveAt: number
  proactiveDate: string
  proactiveCount: number
  followUpDone: boolean
  probeStartedAt: number
  sinceExtract: number
  pendingProactive?: Action
}
export function initialState(now: number): State {
  return {
    phase: 'lurking',
    since: now,
    lastHumanAt: 0,
    lastAiAt: 0,
    lastProactiveAt: 0,
    proactiveDate: localDate(now),
    proactiveCount: 0,
    followUpDone: false,
    probeStartedAt: 0,
    sinceExtract: 0,
  }
}
export function resetDate(state: State, now: number): State {
  return state.proactiveDate === localDate(now)
    ? { ...state }
    : { ...state, proactiveDate: localDate(now), proactiveCount: 0 }
}
export function nextProbeAt(state: State, config: Settings, now: number, random: number): number | null {
  const s = resetDate(state, now)
  if (!['active', 'lurking'].includes(s.phase) || s.pendingProactive || s.proactiveCount >= config.dailyProactive)
    return null
  if (s.phase === 'lurking' && (!s.lastHumanAt || now - s.lastHumanAt >= 86400000)) return null
  const hours = dailyHours(config.activeHours)
  const total = hours.reduce((sum, [start, end]) => sum + end - start, 0)
  if (!total) return null
  let slot = s.proactiveCount
  // 将额度分散到全天活跃时间；按实际发言所在时段推进，错过的时段不连续补发。
  if (s.lastProactiveAt && localDate(s.lastProactiveAt) === localDate(now)) {
    const last = new Date(s.lastProactiveAt)
    const minute = last.getHours() * 60 + last.getMinutes() + last.getSeconds() / 60 + last.getMilliseconds() / 60000
    const elapsed = hours.reduce((sum, [start, end]) => sum + Math.max(0, Math.min(minute, end) - start), 0)
    slot = Math.max(slot, Math.floor((elapsed * config.dailyProactive) / total) + 1)
  }
  if (slot >= config.dailyProactive) return null
  let remaining = (slot * total) / config.dailyProactive
  let slotStart = 0
  for (const [start, end] of hours) {
    if (remaining < end - start) {
      const minute = start + remaining
      const date = new Date(now)
      date.setHours(0, Math.floor(minute), 0, Math.round((minute % 1) * 60000))
      slotStart = date.getTime()
      break
    }
    remaining -= end - start
  }
  return Math.max(
    (Math.max(s.lastHumanAt, s.lastAiAt) || s.since) +
      config.idleMinutes * 60000 * (1 + Math.max(0, Math.min(1, random)) * 0.2),
    s.lastProactiveAt ? s.lastProactiveAt + config.minProactiveGapMinutes * 60000 : 0,
    slotStart,
  )
}
export function act(state: State, action: Action, now: number): State {
  const s = resetDate(state, now)
  return {
    ...s,
    phase: action === 'exit' ? 'exiting' : 'probing',
    since: now,
    pendingProactive: action,
    lastProactiveAt: action === 'exit' ? s.lastProactiveAt : now,
    proactiveCount: s.proactiveCount + (action === 'exit' ? 0 : 1),
    probeStartedAt: now,
    followUpDone: action === 'followup' || (action !== 'probe' && s.followUpDone),
  }
}
export function step(
  state: State,
  input: 'tick' | 'human' | 'assistant',
  config: Settings,
  now: number,
  random: number,
): { state: State; action: Action | 'none' } {
  let s = resetDate(state, now)
  const phase = (value: State['phase']) => {
    if (s.phase !== value) s = { ...s, phase: value, since: now }
  }
  if (input === 'human') {
    s.lastHumanAt = now
    phase('active')
    delete s.pendingProactive
  }
  if (input === 'assistant') {
    s.lastAiAt = now
    if (s.pendingProactive === 'exit') phase('lurking')
    delete s.pendingProactive
  }
  if (s.pendingProactive) return { state: s, action: 'none' }
  const emit = (action: Action) => ({ state: act(s, action, now), action })
  if (input !== 'tick') return { state: s, action: 'none' }
  if (!inHours(config.activeHours, now)) {
    if (s.phase === 'active' || s.phase === 'probing') {
      if (config.exitLine) return emit('exit')
    }
    phase('lurking')
    return { state: s, action: 'none' }
  }
  if (s.phase === 'exiting') phase('lurking')
  else if (s.phase === 'probing' && now - s.probeStartedAt >= config.probeWaitMinutes * 60000) {
    if (config.followUpOnce && !s.followUpDone && s.proactiveCount < config.dailyProactive) return emit('followup')
    if (config.exitLine) return emit('exit')
    phase('lurking')
  } else {
    const at = nextProbeAt(s, config, now, random)
    if (at !== null && now >= at) return emit('probe')
  }
  return { state: s, action: 'none' }
}
