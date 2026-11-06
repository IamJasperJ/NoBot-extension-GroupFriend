import type { Extension } from '../../apps/server/src/extensions/types'
import { commands } from './commands'
import { defaultSettings } from './core/settings'
import { routes } from './routes'
import { createRuntime } from './runtime'
import { settingsSchema } from './schema'

// defineExtension 是无运行时依赖的恒等包装，复制安装后不能通过相对路径加载宿主模块。
let lifetime: AbortSignal | undefined
const defineExtension = (extension: Extension): Extension => extension
export default defineExtension({
  id: 'group-life',
  name: '仿真群友 / Group Friend',
  version: '0.1.0',
  description:
    '主动聊天、群友记忆与人工确认的黑话学习 / Proactive group chat, member memories, and human-confirmed slang learning',
  defaultSettings,
  // 字段内部的 label/hint getter 在宿主浅拷贝后仍保留，语言切换时无需重载扩展。
  get settingsSchema() {
    return settingsSchema()
  },
  routes,
  tools: (ctx) => createRuntime(ctx).tools(ctx.chatId),
  hooks: {
    beforePrompt: (input, ctx) => createRuntime(ctx).beforePrompt(input, ctx.chatId),
    onEvent: (event, ctx) => createRuntime(ctx, { signal: lifetime }).onEvent(event, Date.now()),
  },
  commands,
  startBackground(ctx, signal) {
    lifetime = signal
    const runtime = createRuntime(ctx, { signal })
    ctx.tasks.register({
      id: 'evaluate', name: '仿真群友 / Group Friend',
      schedule: { kind: 'interval', everyMs: 30000, anchor: 0 },
      misfire: 'skip',
    }, () => runtime.tickOnce(Date.now()))
  },
})
