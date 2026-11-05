import type { ExtensionSettingField } from '../../packages/shared/src/schemas/system'
import { defaultSettings, ranges, starred } from './core/settings'
import { t } from './i18n'

const labels: Record<keyof typeof defaultSettings, string> = {
  activeHours: '活跃时段',
  idleMinutes: '冷场分钟数',
  dailyProactive: '每天主动上限',
  minProactiveGapMinutes: '主动最小间隔',
  probeWaitMinutes: '试探等待分钟数',
  followUpOnce: '允许追问一次',
  exitLine: '退场收尾',
  extractEvery: '提取间隔消息数',
  extractWindow: '提取窗口消息数',
  connectionId: '提取连接',
  model: '提取模型',
  maxMembers: '群友印象上限',
  injectTime: '注入时间',
  injectTopics: '注入话题',
  injectMembers: '注入群友印象',
  injectThoughts: '注入待说念头',
  memberTools: '记人工具',
  slangLearning: '学习黑话',
  slangScanDepth: '黑话扫描消息数',
  styleHint: '群聊风格提示',
  injectStyle: '注入风格',
}
export function settingsSchema(): ExtensionSettingField[] {
  const result: ExtensionSettingField[] = []
  for (const key of Object.keys(defaultSettings) as (keyof typeof defaultSettings)[]) {
    const heading = (
      { activeHours: '主动发言', extractEvery: '记忆', slangLearning: '黑话', styleHint: '风格' } as Record<
        string,
        string
      >
    )[key]
    if (heading) result.push({ key: `heading-${key}`, type: 'heading', label: heading })
    const base = {
      key,
      label: labels[key],
      ...(starred.some((item) => item === key) ? { hint: '可在会话设置中覆盖' } : {}),
    }
    if (key === 'connectionId')
      result.push({
        ...base,
        type: 'select',
        optionsSource: 'connections',
        options: [{ value: '', label: '跟随当前会话的连接' }],
        hint: '留空跟随会话；模型留空使用连接默认模型',
      })
    else if (key === 'injectTime')
      result.push({ ...base, type: 'boolean', hint: '告诉角色现在几点、星期几，让问候和话题符合时间' })
    else if (key === 'model') result.push({ ...base, type: 'string', optionsSource: 'models' })
    else if (key === 'styleHint')
      result.push({ ...base, type: 'textarea', rows: 8, hint: '需要英文指令，并要求与对话使用相同语言' })
    else if (key === 'activeHours')
      result.push({ ...base, type: 'string', hint: '逗号分隔，支持跨午夜，例如 09:00-12:00, 19:00-01:00' })
    else if (typeof defaultSettings[key] === 'number')
      result.push({ ...base, type: 'number', min: ranges[key]?.[0], max: ranges[key]?.[1], step: 1 })
    else result.push({ ...base, type: 'boolean' })
  }
  // registry 会浅拷贝扩展对象，但保留字段数组；把动态翻译放在字段属性上，避免首次加载时冻结语言。
  for (const field of result) {
    for (const key of ['label', 'hint'] as const) {
      const source = field[key]
      if (source !== undefined) Object.defineProperty(field, key, { enumerable: true, get: () => t(source) })
    }
    if (field.type === 'select')
      for (const option of field.options) {
        const source = option.label
        Object.defineProperty(option, 'label', { enumerable: true, get: () => t(source) })
      }
  }
  return result
}
