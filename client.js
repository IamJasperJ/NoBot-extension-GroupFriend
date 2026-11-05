// 仿真群友前端：会话设置里的开关与状态、「群友」记忆页、「黑话」审核页。
// 外置扩展不能导入宿主组件和 i18n，翻译随扩展分发，语言跟随宿主页面的 lang。

const en = {
  仿真群友: 'Group friend',
  群友: 'Members',
  黑话: 'Slang',
  潜水: 'Lurking',
  活跃: 'Active',
  试探: 'Probing',
  退场: 'Leaving',
  在这个会话里启用: 'Enable in this chat',
  '角色会在冷场时自己起话题、记住群友，并学习群里的黑话。':
    'The character starts topics when the chat goes quiet, remembers members and learns group slang.',
  '今日主动 {n}/{max}': 'Proactive today {n}/{max}',
  '下次最早 {time}': 'Next at {time}',
  不在活跃时段: 'Outside active hours',
  试探一次: 'Probe now',
  立刻潜水: 'Lurk now',
  活跃时段: 'Active hours',
  冷场分钟: 'Idle minutes',
  每天主动上限: 'Daily proactive limit',
  '留空沿用扩展设置：{value}': 'Empty = extension default: {value}',
  '记忆与黑话 →': 'Memory & slang →',
  请求失败: 'Request failed',
  已保存: 'Saved',
  保存: 'Save',
  '还没有启用仿真群友的会话。在会话设置里打开「仿真群友」后，这里会显示它的话题、念头和群友印象。':
    'No chats use Group friend yet. Turn it on in a chat’s settings to see its topics, thoughts and member impressions here.',
  当前话题: 'Current topics',
  '群里最近在聊什么（最多 5 条，只注入 24 小时内的）':
    'What the group talks about (up to 5; only the last 24 hours are injected)',
  待说的念头: 'Pending thoughts',
  '角色想找机会说的话（最多 3 条，主动发言用掉后删除）':
    'Things the character wants to bring up (up to 3; removed once used)',
  群友印象: 'Member impressions',
  '只注入最近 30 条消息里出现过的人': 'Only people seen in the last 30 messages are injected',
  添加: 'Add',
  名字: 'Name',
  印象: 'Impression',
  删除: 'Delete',
  暂无: 'None yet',
  打开会话: 'Open chat',
  待确认: 'Pending',
  已确认: 'Confirmed',
  已拉黑: 'Blocked',
  全部会话: 'All chats',
  释义: 'Meaning',
  词: 'Term',
  确认: 'Confirm',
  仅本会话: 'This chat only',
  拒绝: 'Reject',
  拉黑: 'Block',
  解除: 'Unblock',
  全局: 'Global',
  本会话: 'This chat',
  '没有待确认的词。群里出现反复使用、含义不明的词时，提取记忆会顺带列在这里。':
    'Nothing to review. Recurring words with unclear meaning are listed here when memory is extracted.',
  没有已确认的词: 'No confirmed terms',
  没有拉黑的词: 'No blocked terms',
  手动添加: 'Add manually',
  '拉黑的词不会再被提议。': 'Blocked terms are never proposed again.',
  '确认后，群里聊到这个词时角色会知道它的意思。':
    'Once confirmed, the character knows the meaning whenever it comes up.',
  '{n} 分钟前': '{n} min ago',
  '{n} 小时前': '{n} h ago',
  刚刚: 'just now',
  范围: 'Scope',
}
function t(zh, vars) {
  let text = document.documentElement.lang.startsWith('en') ? (en[zh] ?? zh) : zh
  if (vars) for (const [key, value] of Object.entries(vars)) text = text.replaceAll(`{${key}}`, String(value))
  return text
}
const PHASES = { lurking: '潜水', active: '活跃', probing: '试探', exiting: '退场' }
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
function ago(ms) {
  const minutes = Math.floor((Date.now() - ms) / 60000)
  if (minutes < 1) return t('刚刚')
  return minutes < 60 ? t('{n} 分钟前', { n: minutes }) : t('{n} 小时前', { n: Math.floor(minutes / 60) })
}

export default function activate(api) {
  const { createElement: h, useState, useEffect, useCallback } = api.React

  async function request(path, init) {
    const response = await api.fetchServer(path, {
      ...init,
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error?.message ?? t('请求失败'))
    return data
  }
  const send = (path, method, body) =>
    request(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })
  const fail = (error) => api.toast.error(error instanceof Error ? error.message : t('请求失败'))

  /** 读取一个接口并提供刷新；路径为空时不请求 */
  function useResource(path) {
    const [data, setData] = useState(null)
    const [error, setError] = useState(null)
    const reload = useCallback(() => {
      if (!path) return Promise.resolve()
      return request(path)
        .then((value) => {
          setData(value)
          setError(null)
        })
        .catch((e) => setError(e instanceof Error ? e.message : t('请求失败')))
    }, [path])
    useEffect(() => {
      setData(null)
      void reload()
    }, [reload])
    return { data, error, reload, setData }
  }

  const Switch = ({ checked, onChange, disabled, label }) =>
    h('button', {
      type: 'button',
      role: 'switch',
      className: 'gl-switch',
      'aria-checked': checked,
      'aria-label': label,
      disabled,
      onClick: () => onChange(!checked),
    })
  const Pill = ({ phase }) => h('span', { className: `gl-pill ${phase}` }, t(PHASES[phase] ?? phase))

  /** 数字 / 文本覆盖项：失焦保存；留空表示沿用扩展设置 */
  function OverrideInput({ value, fallback, type, onSave }) {
    const [draft, setDraft] = useState(value ?? '')
    useEffect(() => setDraft(value ?? ''), [value])
    return h('input', {
      type,
      value: draft,
      placeholder: String(fallback ?? ''),
      title: t('留空沿用扩展设置：{value}', { value: fallback ?? '' }),
      onChange: (e) => setDraft(e.target.value),
      onBlur: () => {
        const next = draft === '' ? undefined : type === 'number' ? Number(draft) : draft
        if (next !== value) onSave(next)
      },
    })
  }

  // ───────── 会话设置面板 ─────────
  function ChatSection({ chatId }) {
    const { data, error, reload } = useResource(chatId ? `chats/${encodeURIComponent(chatId)}` : null)
    const [busy, setBusy] = useState(false)
    const act = (fn) => {
      setBusy(true)
      return fn()
        .then(reload)
        .catch(fail)
        .finally(() => setBusy(false))
    }
    if (error) return h('p', { className: 'gl gl-error' }, error)
    if (!data) return null
    const path = `chats/${encodeURIComponent(chatId)}`
    const saveOverride = (key, value) => {
      const overrides = { ...data.overrides }
      if (value === undefined) delete overrides[key]
      else overrides[key] = value
      void act(() => send(path, 'PUT', { overrides }))
    }
    const state = data.state ?? {}
    const effective = data.effective ?? {}
    return h(
      'div',
      { className: 'gl gl-section' },
      h(
        'div',
        { className: 'gl-row between' },
        h(
          'div',
          { className: 'gl-grow' },
          h('div', null, t('在这个会话里启用')),
          h('p', { className: 'gl-muted' }, t('角色会在冷场时自己起话题、记住群友，并学习群里的黑话。')),
        ),
        h(Switch, {
          checked: !!data.enabled,
          disabled: busy,
          label: t('在这个会话里启用'),
          onChange: (enabled) => act(() => send(path, 'PUT', { enabled })),
        }),
      ),
      data.enabled &&
        h(
          'div',
          { className: 'gl-row wrap' },
          h(Pill, { phase: state.phase ?? 'lurking' }),
          h(
            'span',
            { className: 'gl-muted' },
            t('今日主动 {n}/{max}', {
              // 计数只在当天有效，跨天后服务端下次评估才会重置
              n: state.proactiveDate === new Date().toLocaleDateString('sv-SE') ? (state.proactiveCount ?? 0) : 0,
              max: effective.dailyProactive ?? 0,
            }),
          ),
          data.nextProbeAt &&
            h('span', { className: 'gl-muted' }, t('下次最早 {time}', { time: clock(data.nextProbeAt) })),
          data.inActiveHours === false && h('span', { className: 'gl-muted' }, t('不在活跃时段')),
        ),
      data.enabled &&
        h(
          'div',
          { className: 'gl-dense' },
          h('label', null, t('活跃时段')),
          h(OverrideInput, {
            type: 'text',
            value: data.overrides?.activeHours,
            fallback: data.defaults?.activeHours ?? effective.activeHours,
            onSave: (v) => saveOverride('activeHours', v),
          }),
          h('label', null, t('冷场分钟')),
          h(OverrideInput, {
            type: 'number',
            value: data.overrides?.idleMinutes,
            fallback: data.defaults?.idleMinutes ?? effective.idleMinutes,
            onSave: (v) => saveOverride('idleMinutes', v),
          }),
          h('label', null, t('每天主动上限')),
          h(OverrideInput, {
            type: 'number',
            value: data.overrides?.dailyProactive,
            fallback: data.defaults?.dailyProactive ?? effective.dailyProactive,
            onSave: (v) => saveOverride('dailyProactive', v),
          }),
        ),
      data.enabled &&
        h(
          'div',
          { className: 'gl-row between wrap' },
          h(
            'div',
            { className: 'gl-row' },
            h(
              'button',
              {
                type: 'button',
                className: 'gl-btn',
                disabled: busy,
                onClick: () => act(() => send(`${path}/probe`, 'POST')),
              },
              t('试探一次'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'gl-btn',
                disabled: busy,
                onClick: () => act(() => send(`${path}/lurk`, 'POST')),
              },
              t('立刻潜水'),
            ),
          ),
          h(
            'button',
            { type: 'button', className: 'gl-link', onClick: () => api.openView('ext:group-life:members', chatId) },
            t('记忆与黑话 →'),
          ),
        ),
    )
  }

  // ───────── 「群友」页：话题、念头、印象 ─────────
  function TextList({ items, onChange, max, multiline }) {
    return h(
      'div',
      { className: 'gl-list' },
      items.length === 0 && h('p', { className: 'gl-muted' }, t('暂无')),
      items.map((item, index) =>
        h(
          'div',
          { className: 'gl-edit-row', key: index },
          h(multiline ? 'textarea' : 'input', {
            value: item.text,
            rows: multiline ? 2 : undefined,
            onChange: (e) => onChange(items.map((x, i) => (i === index ? { ...x, text: e.target.value } : x))),
          }),
          h(
            'button',
            {
              type: 'button',
              className: 'gl-btn icon ghost danger',
              title: t('删除'),
              'aria-label': t('删除'),
              onClick: () => onChange(items.filter((_, i) => i !== index)),
            },
            '✕',
          ),
        ),
      ),
      items.length < max &&
        h(
          'div',
          null,
          h(
            'button',
            { type: 'button', className: 'gl-btn', onClick: () => onChange([...items, { text: '', at: Date.now() }]) },
            `+ ${t('添加')}`,
          ),
        ),
    )
  }

  function MemoryEditor({ chatId, title }) {
    const path = `chats/${encodeURIComponent(chatId)}`
    const { data, error, reload } = useResource(path)
    const [draft, setDraft] = useState(null)
    const [saving, setSaving] = useState(false)
    useEffect(() => {
      if (!data) return
      const memory = data.memory ?? {}
      setDraft({
        topics: memory.topics ?? [],
        thoughts: memory.thoughts ?? [],
        members: Object.entries(memory.members ?? {})
          .map(([name, value]) => ({ name, impression: value.impression, at: value.at }))
          .sort((a, b) => b.at - a.at),
      })
    }, [data])
    if (error) return h('p', { className: 'gl-error' }, error)
    if (!draft) return null
    const save = () => {
      setSaving(true)
      const members = {}
      for (const m of draft.members)
        if (m.name.trim() && m.impression.trim())
          members[m.name.trim()] = { impression: m.impression.trim(), at: m.at ?? Date.now() }
      send(`${path}/memory`, 'PUT', {
        topics: draft.topics.filter((x) => x.text.trim()),
        thoughts: draft.thoughts.filter((x) => x.text.trim()),
        members,
      })
        .then(() => {
          api.toast.info(t('已保存'))
          return reload()
        })
        .catch(fail)
        .finally(() => setSaving(false))
    }
    const state = data.state ?? {}
    return h(
      'div',
      { className: 'gl-list', style: { gap: 12 } },
      h(
        'div',
        { className: 'gl-head' },
        h(
          'div',
          { className: 'gl-row gl-grow' },
          h('h3', { className: 'gl-item-title' }, title),
          h(Pill, { phase: state.phase ?? 'lurking' }),
        ),
        h(
          'div',
          { className: 'gl-row' },
          h('button', { type: 'button', className: 'gl-btn', onClick: () => api.openChat(chatId) }, t('打开会话')),
          h('button', { type: 'button', className: 'gl-btn primary', disabled: saving, onClick: save }, t('保存')),
        ),
      ),
      h(
        'section',
        { className: 'gl-card' },
        h(
          'div',
          { className: 'gl-card-title' },
          t('当前话题'),
          h('span', { className: 'gl-muted' }, t('群里最近在聊什么（最多 5 条，只注入 24 小时内的）')),
        ),
        h(TextList, { items: draft.topics, max: 5, onChange: (topics) => setDraft({ ...draft, topics }) }),
      ),
      h(
        'section',
        { className: 'gl-card' },
        h(
          'div',
          { className: 'gl-card-title' },
          t('待说的念头'),
          h('span', { className: 'gl-muted' }, t('角色想找机会说的话（最多 3 条，主动发言用掉后删除）')),
        ),
        h(TextList, {
          items: draft.thoughts,
          max: 3,
          multiline: true,
          onChange: (thoughts) => setDraft({ ...draft, thoughts }),
        }),
      ),
      h(
        'section',
        { className: 'gl-card' },
        h(
          'div',
          { className: 'gl-card-title' },
          t('群友印象'),
          h('span', { className: 'gl-muted' }, t('只注入最近 30 条消息里出现过的人')),
        ),
        draft.members.length === 0 && h('p', { className: 'gl-muted' }, t('暂无')),
        draft.members.map((member, index) => {
          const patch = (value) =>
            setDraft({ ...draft, members: draft.members.map((m, i) => (i === index ? { ...m, ...value } : m)) })
          return h(
            'div',
            { className: 'gl-member', key: index },
            h('input', {
              value: member.name,
              placeholder: t('名字'),
              onChange: (e) => patch({ name: e.target.value }),
            }),
            h('textarea', {
              value: member.impression,
              rows: 2,
              placeholder: t('印象'),
              maxLength: 200,
              onChange: (e) => patch({ impression: e.target.value }),
            }),
            h(
              'button',
              {
                type: 'button',
                className: 'gl-btn icon ghost danger',
                title: t('删除'),
                'aria-label': t('删除'),
                onClick: () => setDraft({ ...draft, members: draft.members.filter((_, i) => i !== index) }),
              },
              '✕',
            ),
          )
        }),
        h(
          'div',
          null,
          h(
            'button',
            {
              type: 'button',
              className: 'gl-btn',
              onClick: () =>
                setDraft({ ...draft, members: [{ name: '', impression: '', at: Date.now() }, ...draft.members] }),
            },
            `+ ${t('添加')}`,
          ),
        ),
      ),
    )
  }

  function MembersPage() {
    const { data, error, reload } = useResource('chats')
    const [selected, setSelected] = useState(api.getChatId())
    useEffect(() => {
      const timer = setInterval(() => void reload(), 30000)
      return () => clearInterval(timer)
    }, [reload])
    const chats = (data?.chats ?? []).filter((c) => c.enabled)
    const current = chats.find((c) => c.chatId === selected) ?? chats[0]
    return h(
      'div',
      { className: 'gl gl-page' },
      error && h('p', { className: 'gl-error' }, error),
      data &&
        chats.length === 0 &&
        h(
          'div',
          { className: 'gl-empty' },
          t('还没有启用仿真群友的会话。在会话设置里打开「仿真群友」后，这里会显示它的话题、念头和群友印象。'),
        ),
      current &&
        h(
          'div',
          { className: 'gl-split' },
          h(
            'nav',
            { className: 'gl-card', style: { padding: 6 } },
            h(
              'div',
              { className: 'gl-list' },
              chats.map((chat) =>
                h(
                  'button',
                  {
                    key: chat.chatId,
                    type: 'button',
                    className: 'gl-item',
                    'aria-current': chat.chatId === current.chatId,
                    onClick: () => setSelected(chat.chatId),
                  },
                  h('span', { className: 'gl-item-title' }, chat.title),
                  h(
                    'span',
                    { className: 'gl-row' },
                    h(Pill, { phase: chat.phase }),
                    h(
                      'span',
                      { className: 'gl-muted' },
                      t('今日主动 {n}/{max}', { n: chat.proactiveToday, max: chat.dailyProactive }),
                    ),
                  ),
                  chat.lastHumanAt ? h('span', { className: 'gl-muted' }, ago(chat.lastHumanAt)) : null,
                ),
              ),
            ),
          ),
          h(MemoryEditor, { key: current.chatId, chatId: current.chatId, title: current.title }),
        ),
    )
  }

  // ───────── 「黑话」页 ─────────
  function SlangRow({ entry, tab, chats, onDone }) {
    const [meaning, setMeaning] = useState(entry.meaning ?? '')
    const [busy, setBusy] = useState(false)
    const run = (fn) => {
      setBusy(true)
      fn()
        .then(onDone)
        .catch(fail)
        .finally(() => setBusy(false))
    }
    const base = `slang/${encodeURIComponent(entry.id)}`
    const chatTitle = entry.chatId ? (chats.find((c) => c.chatId === entry.chatId)?.title ?? entry.chatId) : null
    const actions =
      tab === 'pending'
        ? [
            h(
              'button',
              {
                key: 'g',
                type: 'button',
                className: 'gl-btn primary',
                disabled: busy || !meaning.trim(),
                onClick: () => run(() => send(`${base}/confirm`, 'POST', { meaning, scope: 'global' })),
              },
              t('确认'),
            ),
            entry.chatId &&
              h(
                'button',
                {
                  key: 'c',
                  type: 'button',
                  className: 'gl-btn',
                  disabled: busy || !meaning.trim(),
                  onClick: () => run(() => send(`${base}/confirm`, 'POST', { meaning, scope: 'chat' })),
                },
                t('仅本会话'),
              ),
            h(
              'button',
              {
                key: 'r',
                type: 'button',
                className: 'gl-btn',
                disabled: busy,
                onClick: () => run(() => send(`${base}/reject`, 'POST')),
              },
              t('拒绝'),
            ),
            h(
              'button',
              {
                key: 'b',
                type: 'button',
                className: 'gl-btn danger',
                disabled: busy,
                onClick: () => run(() => send(`${base}/block`, 'POST')),
              },
              t('拉黑'),
            ),
          ]
        : tab === 'confirmed'
          ? [
              h(
                'button',
                {
                  key: 's',
                  type: 'button',
                  className: 'gl-btn',
                  disabled: busy || meaning === entry.meaning || !meaning.trim(),
                  onClick: () => run(() => send(base, 'PATCH', { meaning })),
                },
                t('保存'),
              ),
              h(
                'button',
                {
                  key: 'd',
                  type: 'button',
                  className: 'gl-btn danger',
                  disabled: busy,
                  onClick: () => run(() => send(base, 'DELETE')),
                },
                t('删除'),
              ),
            ]
          : [
              h(
                'button',
                {
                  key: 'u',
                  type: 'button',
                  className: 'gl-btn',
                  disabled: busy,
                  onClick: () => run(() => send(base, 'DELETE')),
                },
                t('解除'),
              ),
            ]
    return h(
      'div',
      { className: 'gl-slang' },
      h(
        'div',
        null,
        h('div', { className: 'gl-term' }, entry.term),
        h(
          'span',
          { className: 'gl-pill plain', style: { marginTop: 4 } },
          entry.scope === 'chat' && chatTitle ? chatTitle : t(entry.scope === 'chat' ? '本会话' : '全局'),
        ),
      ),
      h(
        'div',
        null,
        tab === 'blocked'
          ? h('div', { className: 'gl-muted', style: { paddingTop: 5 } }, entry.meaning || '—')
          : h('input', { value: meaning, placeholder: t('释义'), onChange: (e) => setMeaning(e.target.value) }),
        entry.example && h('div', { className: 'gl-example' }, `“${entry.example}”`),
      ),
      h('div', { className: 'gl-actions' }, actions),
    )
  }

  function AddSlang({ onDone }) {
    const [term, setTerm] = useState('')
    const [meaning, setMeaning] = useState('')
    const submit = () =>
      send('slang', 'POST', { term: term.trim(), meaning: meaning.trim(), scope: 'global' })
        .then(() => {
          setTerm('')
          setMeaning('')
          onDone()
        })
        .catch(fail)
    return h(
      'div',
      { className: 'gl-slang' },
      h('input', { value: term, placeholder: t('词'), onChange: (e) => setTerm(e.target.value) }),
      h('input', {
        value: meaning,
        placeholder: t('释义'),
        onChange: (e) => setMeaning(e.target.value),
        onKeyDown: (e) => e.key === 'Enter' && term.trim() && meaning.trim() && submit(),
      }),
      h(
        'div',
        { className: 'gl-actions' },
        h(
          'button',
          { type: 'button', className: 'gl-btn', disabled: !term.trim() || !meaning.trim(), onClick: submit },
          t('手动添加'),
        ),
      ),
    )
  }

  function SlangPage() {
    const [tab, setTab] = useState('pending')
    const [chatId, setChatId] = useState('')
    const chatsResource = useResource('chats')
    const { data, error, reload } = useResource(`slang${chatId ? `?chatId=${encodeURIComponent(chatId)}` : ''}`)
    const chats = (chatsResource.data?.chats ?? []).filter((c) => c.enabled)
    const entries = data?.[tab] ?? []
    const empty = {
      pending: '没有待确认的词。群里出现反复使用、含义不明的词时，提取记忆会顺带列在这里。',
      confirmed: '没有已确认的词',
      blocked: '没有拉黑的词',
    }
    const hint = {
      pending: '确认后，群里聊到这个词时角色会知道它的意思。',
      confirmed: '确认后，群里聊到这个词时角色会知道它的意思。',
      blocked: '拉黑的词不会再被提议。',
    }
    return h(
      'div',
      { className: 'gl gl-page' },
      h(
        'div',
        { className: 'gl-head' },
        h(
          'div',
          { className: 'gl-tabs', role: 'tablist' },
          ['pending', 'confirmed', 'blocked'].map((key) =>
            h(
              'button',
              {
                key,
                type: 'button',
                role: 'tab',
                className: 'gl-tab',
                'aria-selected': tab === key,
                onClick: () => setTab(key),
              },
              t({ pending: '待确认', confirmed: '已确认', blocked: '已拉黑' }[key]),
              data?.[key]?.length ? h('span', { className: 'gl-count' }, data[key].length) : null,
            ),
          ),
        ),
        h(
          'select',
          { value: chatId, style: { width: 200 }, 'aria-label': t('范围'), onChange: (e) => setChatId(e.target.value) },
          h('option', { value: '' }, t('全部会话')),
          chats.map((c) => h('option', { key: c.chatId, value: c.chatId }, c.title)),
        ),
      ),
      error && h('p', { className: 'gl-error' }, error),
      h(
        'section',
        { className: 'gl-card' },
        h('p', { className: 'gl-muted' }, t(hint[tab])),
        h(
          'div',
          null,
          tab === 'confirmed' && h(AddSlang, { onDone: reload }),
          data && entries.length === 0 && h('div', { className: 'gl-empty', style: { marginTop: 8 } }, t(empty[tab])),
          entries.map((entry) =>
            h(SlangRow, { key: `${entry.id}:${entry.meaning}`, entry, tab, chats, onDone: reload }),
          ),
        ),
      ),
    )
  }

  api.registerSlot('chat.settings.sections', {
    id: 'group-life',
    title: t('仿真群友'),
    order: 60,
    render: ({ chatId }) => h(ChatSection, { chatId }),
  })
  api.registerPage({ id: 'members', label: t('群友'), icon: '👥', render: () => h(MembersPage) })
  api.registerPage({ id: 'slang', label: t('黑话'), icon: '💬', render: () => h(SlangPage) })
}
