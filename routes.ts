import type { Context as HonoContext } from '../../apps/server/node_modules/hono'
import type { Extension } from '../../apps/server/src/extensions/types'
import { parseMemoryPatch } from './core/memory'
import { defaults, keys, object, overrides, text } from './core/settings'
import { changeSlang, parseEntry } from './core/slang'
import { listApiPresets, listCaptionModels, listChats } from './host'
import { t } from './i18n'
import { createRuntime } from './runtime'

function failure(c: HonoContext, error: unknown) {
  const code =
    error instanceof SyntaxError ? 'INVALID_INPUT' : error instanceof Error ? error.message : 'INTERNAL_ERROR'
  const messages: Record<string, string> = {
    INVALID_INPUT: t('请求参数无效'),
    CHAT_DISABLED: t('会话尚未启用仿真群友'),
    NOT_FOUND: t('记录不存在'),
    DUPLICATE: t('黑话已经存在'),
    GENERATING: t('正在生成，请稍后重试'),
    TRIGGER_REFUSED: t('宿主暂时拒绝主动发言，请稍后重试'),
  }
  const missing = error && typeof error === 'object' && 'status' in error && error.status === 404
  const known = code in messages
  return c.json(
    {
      error: {
        code: missing ? 'NOT_FOUND' : known ? code : 'INTERNAL_ERROR',
        message: missing ? t('记录不存在') : (messages[code] ?? t('操作失败')),
      },
    },
    missing || code === 'NOT_FOUND'
      ? 404
      : code === 'GENERATING' || code === 'TRIGGER_REFUSED'
        ? 409
        : known || error instanceof SyntaxError
          ? 400
          : 500,
  )
}
export const routes: NonNullable<Extension['routes']> = (app, ctx) => {
  const runtime = createRuntime(ctx)
  app.onError((error, c) => failure(c, error))
  app.get('/chats', (c) => {
    const titles = new Map(listChats({}).map((chat) => [chat.id, chat.title]))
    const chats = runtime.store
      .chats()
      .filter((id) => runtime.enabled(id) && titles.has(id))
      .map((id) => {
        const detail = runtime.detail(id, Date.now())
        return {
          chatId: id,
          title: titles.get(id)!,
          enabled: true,
          phase: detail.state.phase,
          proactiveToday: detail.state.proactiveCount,
          dailyProactive: detail.effective.dailyProactive,
          nextProbeAt: detail.nextProbeAt,
          lastHumanAt: detail.state.lastHumanAt,
          inActiveHours: detail.inActiveHours,
        }
      })
    return c.json({ chats })
  })
  const detail = (id: string) => {
    const value = runtime.detail(id, Date.now())
    return { ...value, defaults: defaults(value.defaults) }
  }
  app.get('/chats/:chatId', (c) => c.json(detail(c.req.param('chatId'))))
  app.put('/chats/:chatId', async (c) => {
    const id = c.req.param('chatId')
    ctx.host.getChatInfo(id, 0)
    const body = object(await c.req.json())
    keys(body, ['enabled', 'overrides'])
    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') throw new Error('INVALID_INPUT')
    const current = runtime.store.chat(id)
    const next = {
      enabled: body.enabled === undefined ? current.enabled : (body.enabled as boolean),
      overrides: body.overrides === undefined ? current.overrides : overrides(body.overrides),
    }
    if (next.enabled && !current.enabled) runtime.initialize(id, Date.now())
    if (!next.enabled && current.enabled) runtime.lurk(id, Date.now())
    runtime.store.saveChat(id, next)
    return c.json(detail(id))
  })
  app.put('/chats/:chatId/memory', async (c) => {
    const id = c.req.param('chatId')
    ctx.host.getChatInfo(id, 0)
    const max = runtime.config(id).maxMembers
    const patch = parseMemoryPatch(await c.req.json(), max)
    const memory = { ...runtime.store.memory(id, max), ...patch }
    runtime.store.saveMemory(id, memory)
    return c.json({ memory })
  })
  for (const action of ['probe', 'lurk'] as const)
    app.post(`/chats/:chatId/${action}`, (c) => {
      const id = c.req.param('chatId')
      runtime[action](id, Date.now())
      return c.json(detail(id))
    })
  app.get('/slang', (c) => {
    const chatId = c.req.query('chatId')
    const entries = runtime.store
      .slang()
      .entries.filter((entry) => !chatId || entry.scope === 'global' || entry.chatId === chatId)
    return c.json({
      pending: entries.filter((entry) => entry.status === 'pending'),
      confirmed: entries.filter((entry) => entry.status === 'confirmed'),
      blocked: entries.filter((entry) => entry.status === 'blocked'),
    })
  })
  app.post('/slang', async (c) => {
    const body = object(await c.req.json())
    keys(body, ['term', 'meaning', 'example', 'scope', 'chatId'])
    const entry = parseEntry({ ...body, id: crypto.randomUUID(), status: 'confirmed', at: Date.now() })
    if (entry.scope === 'chat') ctx.host.getChatInfo(entry.chatId!, 0)
    const glossary = runtime.store.slang()
    if (glossary.entries.some((other) => other.term.toLowerCase() === entry.term.toLowerCase()))
      throw new Error('DUPLICATE')
    runtime.store.saveSlang({ entries: [...glossary.entries, entry] })
    return c.json({ entry })
  })
  app.patch('/slang/:id', async (c) => {
    const id = c.req.param('id')
    const glossary = changeSlang(runtime.store.slang(), id, 'patch', object(await c.req.json()))
    const entry = glossary.entries.find((entry) => entry.id === id)!
    if (entry.scope === 'chat') ctx.host.getChatInfo(entry.chatId!, 0)
    runtime.store.saveSlang(glossary)
    return c.json({ entry })
  })
  for (const action of ['confirm', 'reject', 'block'] as const)
    app.post(`/slang/:id/${action}`, async (c) => {
      const id = c.req.param('id')
      const patch = action === 'confirm' ? object(await c.req.json()) : {}
      const glossary = changeSlang(runtime.store.slang(), id, action, patch)
      runtime.store.saveSlang(glossary)
      return c.json(action === 'reject' ? { ok: true } : { entry: glossary.entries.find((entry) => entry.id === id)! })
    })
  app.delete('/slang/:id', (c) => {
    runtime.store.saveSlang(changeSlang(runtime.store.slang(), c.req.param('id'), 'reject'))
    return c.json({ ok: true })
  })
  app.post('/connections', (c) =>
    c.json({
      options: [
        { value: '', label: t('跟随当前会话的连接') },
        ...listApiPresets().map((connection) => ({ value: connection.id, label: connection.name })),
      ],
    }),
  )
  app.post('/models', async (c) => {
    const body = object(await c.req.json())
    const draft = body.settings === undefined ? {} : object(body.settings)
    const connectionId = draft.connectionId ?? ctx.settings.connectionId ?? ''
    if (typeof connectionId !== 'string' || (body.chatId !== undefined && typeof body.chatId !== 'string'))
      throw new Error('INVALID_INPUT')
    const chatId = body.chatId === undefined || body.chatId === '' ? undefined : text(body.chatId, 200)
    return c.json({
      options: (await listCaptionModels(connectionId, chatId)).map((value) => ({ value, label: value })),
    })
  })
}
