import { localDate } from './hours'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
const TIME_PERIODS = [
  { start: 0, end: 5, name: 'late night' },
  { start: 5, end: 8, name: 'early morning' },
  { start: 8, end: 11, name: 'morning' },
  { start: 11, end: 13, name: 'midday' },
  { start: 13, end: 17, name: 'afternoon' },
  { start: 17, end: 19, name: 'early evening' },
  { start: 19, end: 23, name: 'evening' },
  { start: 23, end: 24, name: 'late night' },
] as const

/** 与活跃时段使用同一服务器本地时间，避免问候和调度对时间的理解不一致。 */
export function timeHint(now: number): string {
  const date = new Date(now)
  const hour = date.getHours()
  const period = TIME_PERIODS.find(({ start, end }) => hour >= start && hour < end)!
  const clock = `${String(hour).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return `Current local time: ${WEEKDAYS[date.getDay()]}, ${localDate(now)} ${clock} (${period.name}). Let the time of day shape what you say (greetings, meals, sleep, work or class), but don't announce the time unless it comes up naturally.`
}
