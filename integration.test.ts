import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ExtensionContext, ExtensionStorage } from '../../apps/server/src/extensions/types'
import type { MessageDTO } from '../../packages/shared/src'
import { defaultSettings } from './core/settings'
import type { SlangEntry } from './core/slang'
import { initialState } from './core/state'
import type { ChatDetail, ChatListItem, Option } from './dto'

type TestResponse = ChatDetail & {
  chats: ChatListItem[]
  options: Option[]
  pending: SlangEntry[]
  confirmed: SlangEntry[]
  blocked: SlangEntry[]
  entry: SlangEntry
  ok: boolean
  result: string
}

test('外置安装、宿主主动生成、记忆、注入、工具、黑话接口和关闭隔离', async () => {
  if (!process.env.GROUP_LIFE_CHILD) {
    const child = Bun.spawn([process.execPath, 'test', import.meta.path], {
      cwd: resolve(import.meta.dir, '../..'),
      env: { ...process.env, GROUP_LIFE_CHILD: '1', MOCK_LLM_FETCH: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const timeout = setTimeout(() => child.kill(), 45000)
    try {
      const [out, err, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect(code, out + err).toBe(0)
    } finally {
      clearTimeout(timeout)
    }
    return
  }
  const directory = await mkdtemp(join(tmpdir(), 'group-life-'))
  process.env.DATA_DIR = directory
  const { runAsUser, closeUserDatabase, userPaths } = await import('../../apps/server/src/user-context')
  const user = { id: 'group-life-test', handle: 'group-life-test', name: '群友测试', isAdmin: true }
  const { mockLlm } = (await import(join(process.cwd(), 'apps/server/test/helpers/mockLlm.ts'))) as {
    mockLlm(): {
      url: string
      requests: { messages: { role: string; content: string }[] }[]
      setScript(script: () => { text: string }): void
      stop(): void
    }
  }
  const { systemDatabase } = await import('../../apps/server/src/db/system-client')
  const { users } = await import('../../apps/server/src/db/system-schema')
  systemDatabase()
    .insert(users)
    .values({ ...user, passwordHash: 'unused', createdAt: 1 })
    .run()
  const model = mockLlm()
  try {
    await runAsUser(user, async () => {
      const installed = join(userPaths(user.handle).extensions, 'group-life')
      await mkdir(installed, { recursive: true })
      await cp(import.meta.dir, installed, { recursive: true, filter: (path) => !path.endsWith('.test.ts') })
      const registry = await import('../../apps/server/src/extensions/registry')
      const { createExtensionHost } = await import('../../apps/server/src/extensions/host')
      const { getSetting, setSetting } = await import('../../apps/server/src/db/client')
      const { createCharacter } = await import('../../apps/server/src/services/characters')
      const { createChat, getChatRow } = await import('../../apps/server/src/services/chats')
      const { createApiPreset } = await import('../../apps/server/src/services/connections')
      const { apiPresetInput } = await import('../../packages/shared/src')
      const { setAppSettings } = await import('../../apps/server/src/services/settings')
      const { assemble, loadGenerationContext } = await import('../../apps/server/src/services/generation/context')
      const { availableTools } = await import('../../apps/server/src/tools')
      const { createRuntime, speakerName } = (await import(join(installed, 'runtime.ts'))) as typeof import('./runtime')
      const host = createExtensionHost(registry.emitServerEvent)
      const storage: ExtensionStorage = {
        get: <T>(key: string) => getSetting<T>(`extdata:group-life:${key}`),
        set: (key, value) => setSetting(`extdata:group-life:${key}`, value),
        delete: (key) => setSetting(`extdata:group-life:${key}`, undefined),
      }
      const config = { ...defaultSettings, activeHours: '00:00-24:00', idleMinutes: 5, minProactiveGapMinutes: 10 }
      const context: Omit<ExtensionContext, 'chatId'> = { host, storage, settings: config }
      const runtime = createRuntime(context, { random: 0 })
      createApiPreset(apiPresetInput.parse({ name: 'Mock', baseUrl: model.url, model: 'mock-one' }))
      const character = createCharacter({ name: 'Alice' })
      const chat = createChat({ characterId: character.id })
      const other = createChat({ characterId: character.id })
      await registry.ensureUserExtensions()
      const dto = registry.listExtensions().find((entry) => entry.id === 'group-life')!
      expect(dto.loadError).toBeFalsy()
      expect(dto.needsApproval).toBe(true)
      registry.updateExtension('group-life', { enabled: true, approvePermissions: true, settings: config })
      async function request(path: string, method = 'GET', body?: unknown) {
        return registry.forwardExtension(
          'group-life',
          new Request(`http://local/api/ext/group-life${path}`, {
            method,
            ...(body === undefined
              ? {}
              : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
          }),
        )
      }
      const read = async (path: string, method = 'GET', body?: unknown) =>
        (await request(path, method, body)).json() as Promise<TestResponse>
      expect(await read(`/chats/${chat.id}`)).toMatchObject({
        enabled: false,
        memory: { topics: [], thoughts: [], members: {} },
      })
      expect((await request(`/chats/${chat.id}/probe`, 'POST')).status).toBe(400)
      expect((await request(`/chats/${chat.id}`, 'PUT', { overrides: { idleMinutes: 1 } })).status).toBe(400)
      expect((await request(`/chats/${chat.id}`, 'PUT', { unknown: true })).status).toBe(400)
      expect(
        (await request(`/chats/${chat.id}`, 'PUT', { enabled: true, overrides: { dailyProactive: 3 } })).status,
      ).toBe(200)
      expect((await read('/chats')).chats.map((entry: { chatId: string }) => entry.chatId)).toEqual([chat.id])
      expect(Object.keys((await read(`/chats/${chat.id}`)).defaults)).toHaveLength(7)
      expect((await read('/connections', 'POST', {})).options).toHaveLength(2)
      expect((await read('/models', 'POST', { settings: {}, chatId: chat.id })).options).toEqual([
        { value: 'mock-one', label: 'mock-one' },
        { value: 'mock-two', label: 'mock-two' },
      ])
      setAppSettings({ language: 'en' })
      expect(
        registry
          .listExtensions()
          .find((entry) => entry.id === 'group-life')!
          .settingsSchema.find((field) => field.key === 'idleMinutes')!.label,
      ).toBe('Idle minutes')
      setAppSettings({ language: 'zh' })
      expect(
        registry
          .listExtensions()
          .find((entry) => entry.id === 'group-life')!
          .settingsSchema.find((field) => field.key === 'idleMinutes')!.label,
      ).toBe('冷场分钟数')
      const human = host.appendMessage(chat.id, {
        role: 'user',
        content: 'GG，最近在玩策略游戏',
        meta: { name: '小王' },
      })
      await Bun.sleep(10)
      const now = Date.now()
      runtime.store.saveState(chat.id, { ...initialState(now - 3600000), phase: 'active', lastHumanAt: now - 3600000 })
      const memory = {
        topics: [{ text: '策略游戏', at: now }],
        thoughts: [{ text: '问问新游戏', at: now }],
        members: { 小王: { impression: '喜欢策略游戏', at: now } },
      }
      expect((await request(`/chats/${chat.id}/memory`, 'PUT', memory)).status).toBe(200)
      model.setScript(() => ({ text: '最近有什么好玩的策略游戏？' }))
      const requestCount = model.requests.length
      await runtime.tickOnce(now)
      await host.waitIdle(chat.id, 5000)
      await Bun.sleep(10)
      expect(model.requests.length).toBe(requestCount + 1)
      const sent = model.requests.at(-1)!.messages
      expect(sent.filter((message) => message.role === 'system').at(-1)!.content).toContain(
        'The group has been quiet for a while',
      )
      expect(JSON.stringify(sent)).toContain('策略游戏')
      const saved = host.getChatInfo(chat.id, 30).messages.at(-1)!
      expect(saved.role).toBe('assistant')
      expect(saved.content).toContain('策略游戏')
      expect(JSON.stringify(saved)).not.toContain('The group has been quiet')
      expect(runtime.store.state(chat.id, now).proactiveCount).toBe(1)
      expect(runtime.store.state(chat.id, now).pendingProactive).toBeUndefined()
      expect(runtime.store.memory(chat.id, 60).thoughts).toEqual([])
      // 注入仅限开启的会话，工具同样由宿主动态裁剪。
      const built = await assemble(loadGenerationContext(chat.id, { requireConnection: true }), {
        type: 'normal',
        speakerId: character.id,
        leafId: getChatRow(chat.id).activeLeafId,
      })
      expect(built.input.injections?.map((entry) => entry.id)).toContain('group-life-style')
      expect(built.input.injections?.map((entry) => entry.id)).toContain('group-life-memory')
      expect(built.input.injections?.find((entry) => entry.id === 'group-life-style')?.content).toContain(
        "character's own voice",
      )
      expect(built.input.injections?.find((entry) => entry.id === 'group-life-memory')?.content).toContain(
        'Member 小王: 喜欢策略游戏',
      )
      expect(availableTools(chat.id).some(({ tool }) => tool.name === 'remember_member')).toBe(true)
      expect(availableTools(other.id).some(({ tool }) => tool.name === 'remember_member')).toBe(false)
      const tools = runtime.tools(chat.id)
      const toolContext = { chatId: chat.id, vars: {}, signal: AbortSignal.timeout(1000) }
      await tools.find((tool) => tool.name === 'remember_member')!.run({ name: '小王', note: '爱玩桌游' }, toolContext)
      expect(
        (await tools.find((tool) => tool.name === 'recall_member')!.run({ name: '小王' }, toolContext)).content,
      ).toContain('爱玩桌游')
      expect(
        speakerName(
          { ...human, meta: { author: { name: '作者', userId: 'u' } } } as MessageDTO,
          host.getChatInfo(chat.id, 30),
        ),
      ).toBe('作者')
      // 模拟提取器的返回值，不修改共享 mock-llm；延迟承诺验证同会话提取串行。
      let completeCalls = 0
      let release!: (value: string) => void
      const extraction = {
        topics: ['新话题'],
        thoughts: ['新念头'],
        members: [
          { name: '小王', impression: '新印象' },
          { name: 'Alice', impression: '必须过滤' },
        ],
        slang: [{ term: 'GG', meaning: '结束啦', example: 'GG' }],
      }
      const extracting = createRuntime(
        { ...context, settings: { ...config, extractEvery: 5 } },
        {
          complete: async (opts) => {
            completeCalls++
            expect(opts.maxTokens).toBe(800)
            expect(opts.messages[0]!.content).toContain('HUMAN participants ONLY')
            expect(opts.messages[1]!.content).toContain('小王:')
            return new Promise<string>((resolve) => {
              release = resolve
            })
          },
        },
      )
      runtime.store.saveState(chat.id, { ...runtime.store.state(chat.id, now), sinceExtract: 4 })
      const first = extracting.onEvent({ type: 'message:saved', message: human }, now)
      const second = extracting.onEvent({ type: 'message:saved', message: human }, now)
      expect(completeCalls).toBe(1)
      release(JSON.stringify(extraction))
      await Promise.all([first, second])
      expect(runtime.store.state(chat.id, now).sinceExtract).toBe(1)
      expect(runtime.store.memory(chat.id, 60).members.Alice).toBeUndefined()
      expect(runtime.store.memory(chat.id, 60).topics[0]!.text).toBe('新话题')
      const errors: unknown[] = []
      const invalidExtractor = createRuntime(
        {
          ...context,
          settings: { ...config, extractEvery: 5 },
          host: {
            ...host,
            log: (entry) => {
              errors.push(entry)
            },
          },
        },
        { complete: async () => 'not JSON' },
      )
      const memoryBeforeFailure = runtime.store.memory(chat.id, 60)
      runtime.store.saveState(chat.id, { ...runtime.store.state(chat.id, now), sinceExtract: 4 })
      await invalidExtractor.onEvent({ type: 'message:saved', message: human }, now)
      expect(errors).toEqual([expect.objectContaining({ status: 'error', summary: '记忆提取失败' })])
      expect(runtime.store.memory(chat.id, 60)).toEqual(memoryBeforeFailure)
      const controller = new AbortController()
      const aborted = createRuntime(context, { signal: controller.signal })
      controller.abort()
      const stateBeforeAbort = runtime.store.state(chat.id, now)
      await aborted.tickOnce(now + 86400000)
      await aborted.onEvent({ type: 'message:saved', message: human }, now)
      expect(runtime.store.state(chat.id, now)).toEqual(stateBeforeAbort)
      const excluded = { ...human, meta: { excluded: true } }
      const beforeExcluded = runtime.store.state(chat.id, now).sinceExtract
      await extracting.onEvent({ type: 'message:saved', message: excluded }, now)
      expect(runtime.store.state(chat.id, now).sinceExtract).toBe(beforeExcluded)
      const pending = (await read('/slang')).pending[0]!
      expect(pending.term).toBe('GG')
      expect(
        (await read(`/slang/${pending.id}/confirm`, 'POST', { scope: 'chat', meaning: '胜利收工' })).entry.status,
      ).toBe('confirmed')
      const withSlang = await assemble(loadGenerationContext(chat.id, { requireConnection: true }), {
        type: 'normal',
        speakerId: character.id,
        leafId: getChatRow(chat.id).activeLeafId,
      })
      expect(withSlang.input.injections?.find((entry) => entry.id === 'group-life-slang')?.content).toContain(
        '胜利收工',
      )
      expect((await request(`/slang/${pending.id}`, 'PATCH', { scope: 'invalid' })).status).toBe(400)
      expect((await read(`/slang/${pending.id}`, 'PATCH', { meaning: '改释义' })).entry.meaning).toBe('改释义')
      expect((await read(`/slang/${pending.id}/block`, 'POST')).entry.status).toBe('blocked')
      expect((await read(`/slang?chatId=${other.id}`)).blocked).toHaveLength(0)
      expect((await request('/slang', 'POST', { term: 'gg', meaning: '重复', scope: 'global' })).status).toBe(400)
      expect((await read(`/slang/${pending.id}`, 'DELETE')).ok).toBe(true)
      const manual = (await read('/slang', 'POST', { term: '梗', meaning: '说明', scope: 'global' })).entry
      expect((await read(`/slang/${manual.id}/reject`, 'POST')).ok).toBe(true)
      // 生成冲突或房间拒绝不消耗额度；手动试探不受日限约束。
      const refused = createRuntime(
        {
          ...context,
          host: {
            ...host,
            trigger() {
              throw new Error('room refusal')
            },
          },
        },
        { random: 0 },
      )
      const beforeRefusal = { ...initialState(now - 3600000), phase: 'active' as const, lastHumanAt: now - 3600000 }
      runtime.store.saveState(chat.id, beforeRefusal)
      await refused.tickOnce(now)
      expect(runtime.store.state(chat.id, now)).toEqual(beforeRefusal)
      const busy = createRuntime({ ...context, host: { ...host, isGenerating: () => true } }, { random: 0 })
      await busy.tickOnce(now)
      expect(runtime.store.state(chat.id, now)).toEqual(beforeRefusal)
      runtime.store.saveState(chat.id, { ...beforeRefusal, proactiveCount: 20 })
      expect((await request(`/chats/${chat.id}/probe`, 'POST')).status).toBe(200)
      await host.waitIdle(chat.id, 5000)
      expect(runtime.store.state(chat.id, now).proactiveCount).toBe(21)
      expect((await request(`/chats/${chat.id}/lurk`, 'POST')).status).toBe(200)
      expect((await read(`/chats/${chat.id}`)).state.phase).toBe('lurking')
      await request(`/chats/${chat.id}`, 'PUT', { enabled: false })
      const countDisabled = model.requests.length
      await runtime.tickOnce(now + 3600000)
      await extracting.onEvent({ type: 'message:saved', message: human }, now)
      expect(model.requests.length).toBe(countDisabled)
      expect(runtime.tools(chat.id)).toEqual([])
      const disabledBuilt = await assemble(loadGenerationContext(chat.id, { requireConnection: true }), {
        type: 'normal',
        speakerId: character.id,
        leafId: getChatRow(chat.id).activeLeafId,
      })
      expect(disabledBuilt.input.injections?.some((entry) => entry.id.startsWith('group-life')) ?? false).toBe(false)
      expect((await read('/chats')).chats).toEqual([])
      await request(`/chats/${chat.id}`, 'PUT', { enabled: true })
      expect(runtime.store.state(chat.id, now).proactiveCount).toBe(21)
      expect((await read('/commands/glstatus', 'POST', { chatId: chat.id, args: {}, text: '' })).result).toContain(
        '今日主动 21/3',
      )
      await request(`/chats/${chat.id}`, 'PUT', { enabled: false })
      registry.updateExtension('group-life', { enabled: false })
      expect(() =>
        registry.forwardExtension('group-life', new Request('http://local/api/ext/group-life/chats')),
      ).toThrow(expect.objectContaining({ status: 404 }))
      await registry.unloadUserExtensions()
    })
  } finally {
    model.stop()
    closeUserDatabase(user.handle)
    await rm(directory, { recursive: true, force: true })
  }
}, 60000)
