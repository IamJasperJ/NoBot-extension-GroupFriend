import type { ExtensionContext, ServerEvent } from '../../apps/server/src/extensions/types'
import type { ToolDefinition } from '../../apps/server/src/tools'
import type { BuildInput } from '../../packages/core/src'
import type { MessageDTO } from '../../packages/shared/src'
import { inHours } from './core/hours'
import {
  actionInstruction,
  capMembers,
  EXTRACT_PROMPT,
  extractionInput,
  memoryInjection,
  mergeMemory,
  parseExtraction,
  stripStage,
} from './core/memory'
import { settings, text } from './core/settings'
import { mergeSlang, scanSlang } from './core/slang'
import type { Action } from './core/state'
import { act, nextProbeAt, resetDate, step } from './core/state'
import { Store } from './core/store'
import { rhythmHint, staleHint } from './core/style'
import { t } from './i18n'

export type Context = Omit<ExtensionContext, 'chatId'>
type Info = ReturnType<ExtensionContext['host']['getChatInfo']>
const extracting = new Set<string>()
export function speakerName(message: MessageDTO, info: Info): string {
  return (
    message.meta.name ??
    message.meta.author?.name ??
    (message.role === 'assistant'
      ? (info.characters.find((character) => character.id === message.speakerId)?.name ??
        info.characters[0]?.name ??
        'Assistant')
      : info.persona.name)
  )
}
function humans(info: Info): string[] {
  return [
    ...new Set(
      info.messages
        .filter((message) => !message.meta.excluded && message.role === 'user')
        .map((message) => speakerName(message, info)),
    ),
  ]
}
/** 同一轮冷场使用固定抖动，避免每个 tick 重抽导致可见的下次时间跳动。 */
function jitter(id: string, since: number): number {
  let hash = 2166136261
  for (const char of `${id}:${since}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return (hash >>> 0) / 4294967295
}
export function createRuntime(
  ctx: Context,
  seam: { complete?: ExtensionContext['host']['complete']; random?: number; signal?: AbortSignal } = {},
) {
  const store = new Store(ctx.storage)
  const config = (id: string) => settings(ctx.settings, store.chat(id).overrides)
  const enabled = (id: string) => store.chat(id).enabled && !seam.signal?.aborted
  const requireEnabled = (id: string) => {
    if (!enabled(id)) throw new Error('CHAT_DISABLED')
  }
  function actNow(id: string, action: Action, now: number, manual = false): boolean {
    requireEnabled(id)
    if (ctx.host.isGenerating(id)) {
      if (manual) throw new Error('GENERATING')
      return false
    }
    const before = store.state(id, now)
    const info = ctx.host.getChatInfo(id, 30)
    const memory = store.memory(id, config(id).maxMembers)
    // trigger 同步组装提示词，因此先写 pending；若宿主拒绝则完整回滚，不消耗额度。
    store.saveState(id, act(before, action, now))
    try {
      ctx.host.trigger(id, { instruction: actionInstruction(action, memory, humans(info), now) })
      return true
    } catch (error) {
      store.saveState(id, before)
      if (manual) throw new Error('TRIGGER_REFUSED', { cause: error })
      return false
    }
  }
  async function evaluate(id: string, now: number) {
    if (!enabled(id)) return
    const current = store.state(id, now)
    const result = step(
      current,
      'tick',
      config(id),
      now,
      seam.random ?? jitter(id, Math.max(current.since, current.lastHumanAt, current.lastAiAt)),
    )
    if (result.action === 'none') store.saveState(id, result.state)
    else actNow(id, result.action, now)
  }
  async function tickOnce(now: number) {
    for (const id of store.chats()) {
      if (seam.signal?.aborted) return
      try {
        await evaluate(id, now)
      } catch {
        ctx.host.log({ kind: 'extension', status: 'error', chatId: id, summary: t('后台评估失败') })
      }
    }
  }
  async function extract(id: string, now: number) {
    if (extracting.has(id) || !enabled(id)) return
    const state = store.state(id, now)
    const cfg = config(id)
    if (state.sinceExtract < cfg.extractEvery) return
    extracting.add(id)
    store.saveState(id, { ...state, sinceExtract: 0 })
    try {
      const info = ctx.host.getChatInfo(id, cfg.extractWindow)
      const recent = info.messages.filter((message) => !message.meta.excluded)
      const transcript = recent
        .map((message) => `${speakerName(message, info)}: ${stripStage(message.content)}`.slice(0, 300))
        .join('\n')
      const memory = store.memory(id, cfg.maxMembers)
      const raw = await (seam.complete ?? ctx.host.complete)({
        chatId: id,
        connectionId: cfg.connectionId || undefined,
        model: cfg.model || undefined,
        maxTokens: 800,
        summary: 'group-life memory',
        signal: seam.signal,
        messages: [
          { role: 'system', content: EXTRACT_PROMPT },
          {
            role: 'user',
            content: extractionInput(
              transcript,
              memory,
              info.characters.map((character) => character.name).join(', '),
              humans(info),
            ),
          },
        ],
      })
      const extracted = parseExtraction(raw)
      // 异步期间可能被关闭或编辑；只在仍启用时合并到最新存储，不覆盖新计数。
      if (!enabled(id)) return
      store.saveMemory(
        id,
        mergeMemory(store.memory(id, config(id).maxMembers), extracted, humans(info), config(id).maxMembers, now),
      )
      if (config(id).slangLearning) store.saveSlang(mergeSlang(store.slang(), extracted.slang, id, now))
    } catch {
      if (!seam.signal?.aborted)
        ctx.host.log({ kind: 'extension', status: 'error', chatId: id, summary: t('记忆提取失败') })
    } finally {
      extracting.delete(id)
    }
  }
  async function onEvent(event: ServerEvent, now: number) {
    if (event.type !== 'message:saved' || event.message.meta.excluded) return
    const message = event.message
    const id = message.chatId
    if (!enabled(id)) return
    const current = store.state(id, now)
    if (
      message.role === 'assistant' &&
      current.pendingProactive &&
      config(id).injectThoughts &&
      ['probe', 'followup'].includes(current.pendingProactive)
    ) {
      const memory = store.memory(id, config(id).maxMembers)
      store.saveMemory(id, { ...memory, thoughts: [] })
    }
    const result =
      message.role === 'user' || message.role === 'assistant'
        ? step(
            current,
            message.role === 'user' ? 'human' : 'assistant',
            config(id),
            now,
            seam.random ?? jitter(id, current.since),
          )
        : { state: current, action: 'none' as const }
    store.saveState(id, { ...result.state, sinceExtract: current.sinceExtract + 1 })
    await extract(id, now)
    await evaluate(id, now)
  }
  function beforePrompt(input: BuildInput, chatId: string): BuildInput {
    if (!enabled(chatId)) return input
    const cfg = config(chatId)
    const now = input.now.getTime()
    const state = store.state(chatId, now)
    // 历史正文使用已过滤的 BuildInput；宿主对无 author 的 meta.name 存在不同回退规则，因此在这里校正人名。
    const info = ctx.host.getChatInfo(chatId, 50)
    const namesById = new Map(
      info.messages
        .filter((message) => !message.meta.excluded)
        .map((message) => [message.id, speakerName(message, info)]),
    )
    const history = input.history.map((message) => ({ ...message, name: namesById.get(message.id) ?? message.name }))
    const names = [
      ...new Set(
        history
          .slice(-30)
          .filter((message) => message.role === 'user')
          .map((message) => message.name),
      ),
    ]
    const injections = [...(input.injections ?? [])]
    const push = (id: string, label: string, content: string) => {
      if (content) injections.push({ id, label, content, position: 'after_char', role: 'system' })
    }
    if (cfg.injectStyle && cfg.styleHint.trim()) {
      const said = info.messages.filter((message) => !message.meta.excluded && message.role === 'user')
      const latest = said.at(-1)
      // 主动发言本来就发生在冷场之后，不提醒「旧账」，否则会和起话题的指令冲突。
      const stale = latest && !state.pendingProactive ? staleHint((now - latest.createdAt) / 60000) : ''
      push(
        'group-life-style',
        t('仿真群友风格'),
        [
          cfg.styleHint.trim(),
          rhythmHint(said.slice(-30).map((message) => message.content)),
          stale,
          'Write in the same language as the conversation.',
        ]
          .filter(Boolean)
          .join('\n'),
      )
    }
    push(
      'group-life-memory',
      t('仿真群友记忆'),
      memoryInjection(store.memory(chatId, cfg.maxMembers), state, cfg, names, now),
    )
    if (cfg.slangLearning)
      push(
        'group-life-slang',
        t('仿真群友黑话'),
        scanSlang(
          store.slang(),
          chatId,
          history.map((message) => message.content),
          cfg.slangScanDepth,
        ),
      )
    return { ...input, injections }
  }
  function tools(chatId: string): ToolDefinition[] {
    if (!enabled(chatId) || !config(chatId).memberTools) return []
    return (['remember_member', 'recall_member'] as const).map((name) => ({
      name,
      description:
        name === 'remember_member'
          ? 'Append a concise impression of a human group member. Use their exact name. Never store impressions of AI characters.'
          : 'Recall private notes about a human group member by exact name.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' }, ...(name === 'remember_member' ? { note: { type: 'string' } } : {}) },
        required: name === 'remember_member' ? ['name', 'note'] : ['name'],
        additionalProperties: false,
      },
      run(args, toolContext) {
        requireEnabled(chatId)
        const live = settings(toolContext.extension?.settings ?? ctx.settings, store.chat(chatId).overrides)
        if (!live.memberTools) throw new Error('CHAT_DISABLED')
        const memberName = text(args.name, 100)
        const memory = store.memory(chatId, live.maxMembers)
        if (name === 'recall_member') return { content: memory.members[memberName]?.impression ?? t('暂无笔记') }
        const note = text(args.note, 200)
        const members = Object.fromEntries(Object.entries(memory.members))
        Object.defineProperty(members, memberName, {
          value: {
            impression: [memory.members[memberName]?.impression, note].filter(Boolean).join('\n').slice(-200),
            at: Date.now(),
          },
          enumerable: true,
          configurable: true,
          writable: true,
        })
        store.saveMemory(chatId, { ...memory, members: capMembers(members, live.maxMembers) })
        return { content: t('已记住') }
      },
    }))
  }
  function lurk(id: string, now: number) {
    requireEnabled(id)
    const state = { ...store.state(id, now), phase: 'lurking' as const, since: now }
    delete state.pendingProactive
    store.saveState(id, state)
  }
  function detail(id: string, now: number) {
    const info = ctx.host.getChatInfo(id, 0)
    const chat = store.chat(id)
    const cfg = config(id)
    const state = resetDate(store.state(id, now), now)
    return {
      chatId: id,
      title: info.chat.title,
      ...chat,
      defaults: settings(ctx.settings),
      effective: cfg,
      state,
      memory: store.memory(id, cfg.maxMembers),
      nextProbeAt: chat.enabled
        ? nextProbeAt(
            state,
            cfg,
            now,
            seam.random ?? jitter(id, Math.max(state.since, state.lastHumanAt, state.lastAiAt)),
          )
        : null,
      inActiveHours: inHours(cfg.activeHours, now),
    }
  }
  function initialize(id: string, now: number) {
    const info = ctx.host.getChatInfo(id, 200)
    const state = { ...resetDate(store.state(id, now), now), phase: 'lurking' as const, since: now }
    delete state.pendingProactive
    for (const message of info.messages) {
      if (message.meta.excluded) continue
      if (message.role === 'user') state.lastHumanAt = Math.max(state.lastHumanAt, message.createdAt)
      if (message.role === 'assistant') state.lastAiAt = Math.max(state.lastAiAt, message.createdAt)
    }
    store.saveState(id, state)
  }
  return {
    store,
    config,
    enabled,
    requireEnabled,
    tickOnce,
    onEvent,
    beforePrompt,
    tools,
    lurk,
    detail,
    initialize,
    probe: (id: string, now: number) => actNow(id, 'probe', now, true),
  }
}
