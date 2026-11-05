import type { Extension, ExtensionContext } from '../../apps/server/src/extensions/types'
import { t } from './i18n'
import { createRuntime } from './runtime'

function run(ctx: ExtensionContext, command: 'lurk' | 'wake' | 'glstatus'): string {
  try {
    const runtime = createRuntime(ctx)
    runtime.requireEnabled(ctx.chatId)
    const now = Date.now()
    if (command === 'lurk') {
      runtime.lurk(ctx.chatId, now)
      return t('已潜水')
    }
    if (command === 'wake') {
      runtime.probe(ctx.chatId, now)
      return t('已发起试探')
    }
    const detail = runtime.detail(ctx.chatId, now)
    const phases = { lurking: '潜水', active: '活跃', probing: '试探', exiting: '退场' }
    return t('状态：{phase}，今日主动 {count}/{max}', {
      phase: t(phases[detail.state.phase]),
      count: detail.state.proactiveCount,
      max: detail.effective.dailyProactive,
    })
  } catch (error) {
    const messages: Record<string, string> = {
      CHAT_DISABLED: t('会话尚未启用仿真群友'),
      GENERATING: t('正在生成，请稍后重试'),
      TRIGGER_REFUSED: t('宿主暂时拒绝主动发言，请稍后重试'),
    }
    throw new Error(messages[error instanceof Error ? error.message : ''] ?? t('操作失败'))
  }
}
export const commands: NonNullable<Extension['commands']> = (
  [
    ['lurk', '立刻潜水'],
    ['wake', '立刻试探'],
    ['glstatus', '查看群友状态'],
  ] as const
).map(([name, label]) => ({
  name,
  get description() {
    return t(label)
  },
  args: [],
  async run(ctx) {
    return run(ctx, name)
  },
}))
