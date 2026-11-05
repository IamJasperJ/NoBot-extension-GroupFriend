export type Hours = readonly [number, number][]

export function parseHours(text: string): Hours | null {
  const result: [number, number][] = []
  for (const part of text.split(',')) {
    const match = /^\s*(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})\s*$/.exec(part)
    if (!match) return null
    const [a, b, c, d] = match.slice(1).map(Number) as [number, number, number, number]
    if (a > 23 || c > 24 || b > 59 || d > 59 || (c === 24 && d !== 0)) return null
    const start = a * 60 + b
    const end = c * 60 + d
    if (start === end) return null
    result.push([start, end])
  }
  return result.length ? result : null
}

export function localDate(now: number): string {
  const date = new Date(now)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** 午夜切开并合并重叠区间，避免同一分钟在当天活跃时间轴上重复计数。 */
export function dailyHours(text: string): Hours {
  const ranges = (parseHours(text) ?? [])
    .flatMap(([start, end]): [number, number][] =>
      start < end
        ? [[start, end]]
        : [
            [0, end],
            [start, 1440],
          ],
    )
    .filter(([start, end]) => start < end)
    .sort(([a], [b]) => a - b)
  const merged: [number, number][] = []
  for (const [start, end] of ranges) {
    const last = merged.at(-1)
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  return merged
}

export function inHours(text: string, now: number): boolean {
  const date = new Date(now)
  const minute = date.getHours() * 60 + date.getMinutes()
  return (parseHours(text) ?? []).some(([start, end]) =>
    start < end ? minute >= start && minute < end : minute >= start || minute < end,
  )
}
