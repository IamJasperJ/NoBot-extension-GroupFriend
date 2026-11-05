import { describe, expect, test } from 'bun:test'
import { dailyHours, inHours, localDate, parseHours } from './core/hours'
import {
  actionInstruction,
  emptyMemory,
  memoryInjection,
  mergeMemory,
  parseExtraction,
  parseMemoryPatch,
  stripStage,
} from './core/memory'
import { defaultSettings, overrides, settings } from './core/settings'
import { changeSlang, mergeSlang, scanSlang } from './core/slang'
import { initialState, nextProbeAt, step } from './core/state'
import { Store } from './core/store'
import { DEFAULT_STYLE_HINT, rhythmHint, staleHint } from './core/style'
import { timeHint } from './core/time'

const now = new Date(2026, 9, 29, 20).getTime()
const minute = 60000
const cfg = {
  ...defaultSettings,
  activeHours: '00:00-24:00',
  idleMinutes: 5,
  minProactiveGapMinutes: 10,
  probeWaitMinutes: 2,
}
const active = () => ({ ...initialState(now - 20 * minute), phase: 'active' as const, lastHumanAt: now - 20 * minute })

describe('活跃时段与状态机', () => {
  test.each([
    ['09:00-12:00, 19:00-01:00', 20, 0, true],
    ['19:00-01:00', 0, 59, true],
    ['19:00-01:00', 1, 0, false],
    ['09:00-12:00', 9, 0, true],
    ['09:00-12:00', 12, 0, false],
    ['00:00-24:00', 23, 59, true],
  ])('%s / %i:%i', (hours, hour, minutes, expected) => {
    expect(inHours(hours, new Date(2026, 9, 29, hour, minutes).getTime())).toBe(expected)
  })
  test.each(['', '24:00-01:00', '09:60-12:00', '09:00-24:01', '19:00-19:00', '09:00-12:00, bad'])(
    '拒绝无效时段 %s',
    (hours) => expect(parseHours(hours)).toBeNull(),
  )
  test.each([
    ['冷场起话题', {}, {}, 'probe'],
    ['未到冷场', { lastHumanAt: now - minute }, {}, 'none'],
    ['达到日限', { proactiveCount: 3 }, {}, 'none'],
    ['关闭主动', {}, { dailyProactive: 0 }, 'none'],
    ['最小间隔', { lastProactiveAt: now - minute }, {}, 'none'],
    ['深夜退场', {}, { activeHours: '09:00-12:00' }, 'exit'],
    ['深夜静默', {}, { activeHours: '09:00-12:00', exitLine: false }, 'none'],
  ] as const)('%s', (_label, patch, config, expected) => {
    expect(step({ ...active(), ...patch }, 'tick', { ...cfg, ...config }, now, 0).action).toBe(expected)
  })
  test('抖动在边界推迟且不超过 20%', () => {
    const state = { ...active(), since: now - 5 * minute, lastHumanAt: now - 5 * minute }
    expect(step(state, 'tick', cfg, now, 0).action).toBe('probe')
    expect(step(state, 'tick', cfg, now, 1).action).toBe('none')
    expect(step(state, 'tick', cfg, now + minute, 1).action).toBe('probe')
    expect(nextProbeAt(state, cfg, now, 1)).toBe(now + minute)
  })
  test('按实际发言时段推进，错过的时段不补发', () => {
    const at = (hour: number, minutes = 0) => new Date(2026, 9, 29, hour, minutes).getTime()
    const state = { ...active(), lastHumanAt: at(8), lastProactiveAt: at(8, 30), proactiveCount: 1 }
    expect(nextProbeAt(state, cfg, at(13), 0)).toBe(at(16))
    expect(step(state, 'tick', cfg, at(13), 0).action).toBe('none')
    expect(step(state, 'tick', cfg, at(16), 0).action).toBe('probe')
    const missed = { ...state, lastProactiveAt: 0, proactiveCount: 0 }
    expect(step(missed, 'tick', cfg, at(13), 0).action).toBe('probe')
    const replied = step(step(missed, 'tick', cfg, at(13), 0).state, 'human', cfg, at(13), 0).state
    expect(nextProbeAt(replied, cfg, at(14), 0)).toBe(at(16))
    expect(nextProbeAt({ ...state, lastProactiveAt: at(16), proactiveCount: 1 }, cfg, at(17), 0)).toBeNull()
  })
  test.each([
    [0, 10],
    [1, 12],
    [2, 20],
    [3, 22],
  ])('多段活跃时间的时段 %i 从 %i 点开始', (proactiveCount, hour) => {
    const at = (h: number) => new Date(2026, 9, 29, h).getTime()
    const config = { ...cfg, activeHours: '10:00-13:00, 19:00-24:00', dailyProactive: 4 }
    const state = { ...active(), lastHumanAt: at(8), proactiveCount }
    expect(nextProbeAt(state, config, at(9), 0)).toBe(at(hour))
  })
  test.each([
    [12, 59, 20],
    [19, 0, 20],
    [19, 59, 20],
    [20, 0, 22],
  ])('跨越休息时间的同一时段在 %i:%i 发言后推进到 %i 点', (hour, minutes, nextHour) => {
    const at = (h: number, m = 0) => new Date(2026, 9, 29, h, m).getTime()
    const config = { ...cfg, activeHours: '10:00-13:00, 19:00-24:00', dailyProactive: 4 }
    const state = { ...active(), lastHumanAt: at(8), lastProactiveAt: at(hour, minutes), proactiveCount: 1 }
    expect(nextProbeAt(state, config, at(hour, minutes), 0)).toBe(
      Math.max(at(nextHour), state.lastProactiveAt + config.minProactiveGapMinutes * minute),
    )
  })
  test.each([
    [0, 0],
    [1, 1],
    [2, 19],
    [3, 20],
    [4, 21],
    [5, 22],
    [6, 23],
  ])('跨午夜区间仅计算当天，时段 %i 从 %i 点开始', (proactiveCount, hour) => {
    const at = (h: number) => new Date(2026, 9, 29, h).getTime()
    const config = { ...cfg, activeHours: '19:00-02:00', dailyProactive: 7 }
    const state = { ...active(), lastHumanAt: at(-1), proactiveCount }
    expect(nextProbeAt(state, config, at(0), 0)).toBe(at(hour))
  })
  test('重叠、无序和相邻区间不重复计算活跃分钟', () => {
    expect(dailyHours('19:00-02:00, 01:00-03:00, 10:00-12:00, 11:00-13:00, 13:00-14:00')).toEqual([
      [0, 180],
      [600, 840],
      [1140, 1440],
    ])
    expect(dailyHours('19:00-00:00')).toEqual([[1140, 1440]])
  })
  test('日限和时段限制均可耗尽额度；昨天的主动不占今天的时段', () => {
    expect(nextProbeAt({ ...active(), proactiveCount: 3 }, cfg, now, 0)).toBeNull()
    expect(nextProbeAt(active(), { ...cfg, dailyProactive: 0 }, now, 0)).toBeNull()
    expect(nextProbeAt({ ...active(), lastProactiveAt: now - minute }, cfg, now, 0)).toBeNull()
    const state = {
      ...active(),
      proactiveCount: 3,
      proactiveDate: localDate(now - 86400000),
      lastProactiveAt: now - 86400000,
    }
    expect(step(state, 'tick', cfg, now, 0).action).toBe('probe')
    expect(nextProbeAt({ ...active(), pendingProactive: 'probe' }, cfg, now, 0)).toBeNull()
  })
  test('试探→补一句→退场→潜水；有人接话则活跃', () => {
    let s = step(active(), 'tick', cfg, now, 0).state
    expect(s.pendingProactive).toBe('probe')
    s = step(s, 'assistant', cfg, now, 0).state
    expect(step(s, 'human', cfg, now + minute, 0).state.phase).toBe('active')
    let result = step(s, 'tick', cfg, now + 2 * minute, 0)
    expect(result.action).toBe('followup')
    expect(result.state.proactiveCount).toBe(2)
    s = step(result.state, 'assistant', cfg, now + 2 * minute, 0).state
    result = step(s, 'tick', cfg, now + 4 * minute, 0)
    expect(result.action).toBe('exit')
    expect(result.state.proactiveCount).toBe(2)
    s = step(result.state, 'assistant', cfg, now + 4 * minute, 0).state
    expect(s.phase).toBe('lurking')
    expect(step(s, 'tick', { ...cfg, activeHours: '09:00-12:00' }, now + 5 * minute, 0).action).toBe('none')
  })
  test('追问受日限约束；关闭追问/收尾则潜水', () => {
    const probing = { ...active(), phase: 'probing' as const, probeStartedAt: now - 3 * minute }
    expect(step({ ...probing, proactiveCount: 3 }, 'tick', cfg, now, 0).action).toBe('exit')
    expect(step(probing, 'tick', { ...cfg, followUpOnce: false, exitLine: false }, now, 0).state.phase).toBe('lurking')
  })
  test('不唤醒死群；本地日期变化重置次数', () => {
    const state = { ...initialState(now - 86400001), lastHumanAt: now - 86400001 }
    expect(step(state, 'tick', cfg, now, 0).action).toBe('none')
    expect(step({ ...state, lastHumanAt: now - 60 * minute }, 'tick', cfg, now, 0).action).toBe('probe')
    const yesterday = { ...active(), proactiveCount: 20, proactiveDate: localDate(now - 86400000) }
    expect(step(yesterday, 'tick', cfg, now, 0).state.proactiveCount).toBe(1)
  })
})

const extraction = {
  topics: ['游戏'],
  thoughts: ['推荐新游戏'],
  members: [
    { name: '小王', impression: '喜欢策略游戏' },
    { name: '机器人', impression: '不应记住' },
  ],
  slang: [{ term: 'GG', meaning: '结束了', example: 'GG' }],
}
describe('记忆与黑话', () => {
  test('严格解析 JSON / 围栏；拒绝垃圾、缺字段和超限', () => {
    expect(parseExtraction(JSON.stringify(extraction))).toEqual(extraction)
    expect(parseExtraction(`\n\`\`\`json\n${JSON.stringify(extraction)}\n\`\`\``)).toEqual(extraction)
    for (const source of [
      'garbage',
      '{}',
      '{"topics":[]}',
      JSON.stringify({ ...extraction, extra: true }),
      JSON.stringify({ ...extraction, topics: Array(6).fill('x') }),
    ])
      expect(() => parseExtraction(source)).toThrow()
  })
  test('只合并人类；按精确名字更新；淘汰最旧；替换话题/念头', () => {
    const memory = {
      ...emptyMemory(),
      members: { 旧人: { impression: '旧', at: 1 }, 小王: { impression: '旧印象', at: 2 } },
    }
    const merged = mergeMemory(memory, extraction, ['小王'], 1, now)
    expect(merged.members).toEqual({ 小王: { impression: '喜欢策略游戏', at: now } })
    expect(merged.topics).toEqual([{ text: '游戏', at: now }])
    expect(merged.thoughts).toHaveLength(1)
    expect(memory.members.小王.impression).toBe('旧印象')
  })
  test('记忆注入按时间、参与者、阶段和开关过滤', () => {
    const memory = {
      topics: [
        { text: '过期话题', at: now - 86400001 },
        { text: '新话题', at: now },
      ],
      thoughts: [{ text: '念头', at: now }],
      members: { 小王: { impression: '爱玩游戏', at: 1 }, 小李: { impression: '不在场', at: 1 } },
    }
    const content = memoryInjection(memory, active(), cfg, ['小王'], now)
    expect(content).toContain('新话题')
    expect(content).toContain('爱玩游戏')
    expect(content).toContain('念头')
    expect(content).not.toContain('过期话题')
    expect(content).not.toContain('不在场')
    expect(
      memoryInjection(memory, initialState(now), { ...cfg, injectTopics: false, injectMembers: false }, [], now),
    ).toBe('')
    expect(actionInstruction('probe', memory, [], now)).toContain('新话题')
    expect(actionInstruction('probe', memory, [], now)).not.toContain('过期话题')
    for (const action of ['probe', 'followup', 'exit'] as const)
      expect(actionInstruction(action, memory, ['小王'], now)).toContain('Do not mention being an AI')
    expect(stripStage('hello <cg>image prompt</cg> <pose x="1"/> world')).toBe('hello world')
  })
  test('黑话大小写去重、拉黑、确认、范围与扫描深度', () => {
    let glossary = mergeSlang({ entries: [] }, extraction.slang, 'chat', now)
    const id = glossary.entries[0]!.id
    expect(scanSlang(glossary, 'chat', ['gg'], 10)).toBe('')
    glossary = changeSlang(glossary, id, 'block')
    expect(mergeSlang(glossary, [{ term: 'gg', meaning: 'x', example: 'x' }], 'chat', now).entries).toHaveLength(1)
    glossary = changeSlang(glossary, id, 'confirm', { scope: 'chat', meaning: '改过' })
    expect(scanSlang(glossary, 'chat', ['GG!'], 1)).toContain('改过')
    expect(scanSlang(glossary, 'other', ['GG!'], 1)).toBe('')
    expect(scanSlang(glossary, 'chat', ['GG!', 'no'], 1)).toBe('')
    glossary = changeSlang(glossary, id, 'confirm', { scope: 'global' })
    expect(scanSlang(glossary, 'other', ['GG'], 1)).toContain('改过')
    expect(changeSlang(glossary, id, 'reject').entries).toEqual([])
  })
  test('严格路由输入和损坏存储回退', () => {
    for (const row of [{ unknown: 1 }, { idleMinutes: 4 }, { dailyProactive: 21 }, { activeHours: 'bad' }])
      expect(() => overrides(row)).toThrow()
    expect(settings({ idleMinutes: 'bad' }).idleMinutes).toBe(45)
    expect(() => parseMemoryPatch({ members: { a: { impression: 'x'.repeat(201), at: 1 } } }, 60)).toThrow()
    const storage = new Map<string, unknown>()
    const store = new Store({
      get: <T>(key: string) => storage.get(key) as T | undefined,
      set: (key, value) => {
        storage.set(key, value)
      },
      delete: (key) => {
        storage.delete(key)
      },
    })
    for (const key of ['chats', 'chat:a', 'state:a', 'memory:a', 'slang']) storage.set(key, { corrupt: true })
    expect(store.chats()).toEqual([])
    expect(store.chat('a').enabled).toBe(false)
    expect(store.state('a', now)).toEqual(initialState(now))
    expect(store.memory('a', 60)).toEqual(emptyMemory())
    expect(store.slang()).toEqual({ entries: [] })
    store.saveChat('a', { enabled: true, overrides: {} })
    expect(store.chats()).toEqual(['a'])
    store.saveChat('a', { enabled: false, overrides: {} })
    expect(store.chats()).toEqual([])
  })
})

describe('群聊规则', () => {
  test('真人消息不足时不给节奏参考', () => {
    expect(rhythmHint(['好', '哈哈', '草', '在吗'])).toBe('')
  })
  test('按中位数给节奏参考，短反应多时额外提示', () => {
    const hint = rhythmHint(['草', '难绷', '哈', '今天吃什么', '这个番好看吗我还没看', '？'])
    expect(hint).toContain('about 2 characters')
    expect(hint).toContain('Short reactions')
    expect(
      rhythmHint(['今天吃什么呢', '这个番好看吗', '明天还要上班', '周末去爬山吧', '新出的游戏怎么样']),
    ).not.toContain('Short reactions')
  })
  test('旧消息按时长给不同提醒', () => {
    expect(staleHint(10)).toBe('')
    expect(staleHint(Number.NaN)).toBe('')
    expect(staleHint(45)).toContain('45 minutes')
    expect(staleHint(45)).toContain('just saw this')
    expect(staleHint(200)).toContain('3 hours')
    expect(staleHint(200)).toContain('moved on')
  })
  test('默认风格提示是英文且让位给角色卡', () => {
    expect(defaultSettings.styleHint).toBe(DEFAULT_STYLE_HINT)
    expect(DEFAULT_STYLE_HINT).toContain("character's own voice")
    expect(/[一-鿿]/.test(DEFAULT_STYLE_HINT)).toBe(false)
  })
})

describe('时间提示', () => {
  test.each([
    [0, 0, 'late night'],
    [4, 59, 'late night'],
    [5, 0, 'early morning'],
    [7, 59, 'early morning'],
    [8, 0, 'morning'],
    [10, 59, 'morning'],
    [11, 0, 'midday'],
    [12, 59, 'midday'],
    [13, 0, 'afternoon'],
    [16, 59, 'afternoon'],
    [17, 0, 'early evening'],
    [18, 59, 'early evening'],
    [19, 0, 'evening'],
    [22, 59, 'evening'],
    [23, 0, 'late night'],
    [23, 59, 'late night'],
  ])('%i:%i 的时段为 %s', (hour, minutes, period) => {
    expect(timeHint(new Date(2026, 10, 5, hour, minutes).getTime())).toContain(`(${period}).`)
  })
  test.each(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'])('星期名为 %s', (day) => {
    const offset = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(day)
    expect(timeHint(new Date(2026, 10, 1 + offset, 16, 45).getTime())).toStartWith(`Current local time: ${day},`)
  })
  test('日期、时分补零，英文提示自然使用时间', () => {
    expect(timeHint(new Date(2026, 0, 4, 5, 7).getTime())).toBe(
      "Current local time: Sunday, 2026-01-04 05:07 (early morning). Let the time of day shape what you say (greetings, meals, sleep, work or class), but don't announce the time unless it comes up naturally.",
    )
    expect(timeHint(new Date(2026, 10, 5, 16, 45).getTime())).toContain('Thursday, 2026-11-05 16:45 (afternoon)')
  })
  test.each(['probe', 'followup', 'exit'] as const)('%s 与普通注入共用时间提示并遵守开关', (action) => {
    expect(actionInstruction(action, emptyMemory(), [], now, true)).toStartWith(`${timeHint(now)}\n`)
    expect(actionInstruction(action, emptyMemory(), [], now, false)).not.toContain('Current local time:')
  })
  test('默认开启，允许全局关闭，拒绝会话覆盖', () => {
    expect(settings({}).injectTime).toBe(true)
    expect(settings({ injectTime: false }).injectTime).toBe(false)
    expect(settings({ injectTime: 'false' }).injectTime).toBe(true)
    expect(() => overrides({ injectTime: false })).toThrow()
  })
})
