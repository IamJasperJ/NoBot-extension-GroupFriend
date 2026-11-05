# Group Friend 服务端契约（0.1.0）

基础路径：`/api/ext/group-life`。所有时间均为 Unix 毫秒，活跃时段和每日额度以服务器本地时区计算。
路由需要宿主登录、扩展权限批准和扩展启用；`connections` / `models` 候选接口遵循宿主规则，批准后可在扩展启用前使用。
本文中的 JSON 为字段契约；`dto.ts` 导出会话、选项和错误的 TypeScript 类型。

## 公共模型

`Overrides` 只接受下面七个键；未知键、错误类型、非整数、越界值均返回 400：

| 键 | 类型 / 范围 | 全局默认 |
| --- | --- | --- |
| activeHours | string，逗号分隔 HH:mm-HH:mm，支持跨午夜，结束允许 24:00 | `10:00-13:00, 19:00-24:00` |
| idleMinutes | integer 5–1440 | 45 |
| dailyProactive | integer 0–20 | 3 |
| minProactiveGapMinutes | integer 10–1440 | 120 |
| probeWaitMinutes | integer 2–120 | 12 |
| followUpOnce | boolean | true |
| exitLine | boolean | true |

`Settings` 是上述键加上：

```json
{
  "extractEvery": 20,
  "extractWindow": 40,
  "connectionId": "",
  "model": "",
  "maxMembers": 60,
  "injectTopics": true,
  "injectMembers": true,
  "injectThoughts": true,
  "memberTools": true,
  "slangLearning": true,
  "slangScanDepth": 10,
  "styleHint": "You are chatting in a group chat as one of its members. Your character's own voice (catchphrases, punctuation, emoji, how talkative they are) always comes first; the rules below are only group-chat defaults.\n- Type like a chat message, not an essay. One line carries one idea; keep most lines short (about 30 characters, or 15 words).\n- Usually send one line, at most two; only storytelling or a punchline may take two to four. Put each line on its own line, separated by a single line break with no blank lines, and never split one sentence across two lines.\n- Don't use spaces to fake pauses inside a line; use punctuation or just keep writing.\n- You don't need to answer every point or address everyone. A one-word reaction is often better than a forced reply.\n- If you just spoke and nobody picked it up, don't add another line unless you have something new.\n- Watch how this group talks (message length, slang, tone, when people stay quiet) and blend in without copying or echoing anyone.\n- Never mention being an AI or being prompted.",
  "injectStyle": true
}
```

全局数值范围：extractEvery 5–200、extractWindow 10–200、maxMembers 1–1000、slangScanDepth 1–50。
损坏或不合法的全局保存值逐项回退默认值。connectionId 为空跟随会话，model 为空使用连接的默认模型。

`State`：

```json
{
  "phase": "lurking",
  "since": 1793289600000,
  "lastHumanAt": 0,
  "lastAiAt": 0,
  "lastProactiveAt": 0,
  "proactiveDate": "2026-10-29",
  "proactiveCount": 0,
  "followUpDone": false,
  "probeStartedAt": 0,
  "sinceExtract": 0
}
```

phase 为 `lurking | active | probing | exiting`。触发后、助手消息保存前可有
`pendingProactive: "probe" | "followup" | "exit"`。按本地日期读取今日次数；probe / followup 计数，exit 不计数。
手动 probe / wake 忽略活跃时段、冷场、间隔和日限，仍拒绝正在生成及宿主房间拒绝。

`Memory`：

```json
{
  "topics": [{ "text": "最近在玩策略游戏", "at": 1793289600000 }],
  "thoughts": [{ "text": "问问新游戏", "at": 1793289600000 }],
  "members": { "小王": { "impression": "喜欢策略游戏", "at": 1793289600000 } }
}
```

话题最多 5 条、念头最多 3 条，每条 text 非空且最多 300 字符；人名非空且最多 100 字符，impression 非空且最多
200 字符；成员数不得超过有效 maxMembers。at 必须是非负有限数字。编辑时给定部分整体替换，其余部分保留。
降低 maxMembers 后读取时保留最新成员；所有存储读取均验证结构并安全回退。

`SlangEntry`：

```json
{
  "id": "opaque-id",
  "term": "GG",
  "meaning": "结束啦",
  "example": "今天就 GG 了",
  "scope": "chat",
  "chatId": "chat-id",
  "status": "pending",
  "at": 1793289600000
}
```

id 为不透明字符串；example、chatId 可省略，但 scope=chat 时必须有 chatId。
scope 为 `global | chat`，status 为 `pending | confirmed | blocked`。
term 非空且最多 100 字符，meaning 非空且最多 1000 字符，example 如提供则非空且最多 1000 字符。
去重按 term 忽略大小写，跨范围、跨状态统一去重。global 条目可保留来源 chatId，实际全局生效。
拉黑会保留记录、防止再次提议；拒绝/删除会移除记录，以后可重新提议。

## 会话

| 方法 / 路径 | 请求 | 响应 |
| --- | --- | --- |
| GET /chats | 无 | `{ "chats": ChatListItem[] }`，只列已开启且仍存在的会话 |
| GET /chats/:chatId | 无 | `ChatDetail`，从未开启也可读取 |
| PUT /chats/:chatId | `{ "enabled"?: boolean, "overrides"?: Overrides }` | 更新后的 `ChatDetail` |
| PUT /chats/:chatId/memory | `{ "topics"?: Memory.topics, "thoughts"?: Memory.thoughts, "members"?: Memory.members }` | `{ "memory": Memory }` |
| POST /chats/:chatId/probe | 无 | 触发后的 `ChatDetail` |
| POST /chats/:chatId/lurk | 无 | 潜水后的 `ChatDetail` |

`PUT overrides` 整体替换覆盖对象；传 `{}` 清除全部会话覆盖，省略则保留。
第一次启用/重新启用时进入潜水，并从最近 200 条记录补充人类/AI 最近发言时间；保留当天计数、提取计数、记忆和黑话。
禁用后保留数据，停止钩子、工具和后台动作；`/chats` 不再列出该会话。

`ChatListItem`：

```json
{
  "chatId": "chat-id",
  "title": "群聊",
  "enabled": true,
  "phase": "active",
  "proactiveToday": 1,
  "dailyProactive": 3,
  "nextProbeAt": 1793296800000,
  "lastHumanAt": 1793289600000,
  "inActiveHours": true
}
```

`ChatDetail`：

```text
{
  chatId: string, title: string, enabled: boolean,
  overrides: Overrides,
  defaults: 七个可覆盖键的全局值,
  effective: 完整 Settings（全局值 + 会话覆盖）,
  state: State, memory: Memory,
  nextProbeAt: number | null, inActiveHours: boolean
}
```

未开启时 enabled=false、overrides={}、初始潜水状态、空记忆；已有保存数据则返回保存数据。
`nextProbeAt` 是本轮冷场和间隔条件满足的时间，包含固定的 0–20% 抖动；不是预约发言承诺，仍受活跃时段、
生成锁和房间规则约束。当天额度耗尽、等待试探结果、没有近 24 小时人类活动的潜水会话或未开启时为 null。

## 黑话

| 方法 / 路径 | 请求 | 响应 |
| --- | --- | --- |
| GET /slang?chatId= | 无；chatId 可省略 | `{ "pending": SlangEntry[], "confirmed": SlangEntry[], "blocked": SlangEntry[] }` |
| POST /slang | `{ "term": string, "meaning": string, "example"?: string, "scope": "global"或"chat", "chatId"?: string }` | `{ "entry": SlangEntry }`，立即 confirmed |
| PATCH /slang/:id | `{ "term"?: string, "meaning"?: string, "scope"?: "global"或"chat", "chatId"?: string }` | `{ "entry": SlangEntry }` |
| POST /slang/:id/confirm | `{ "meaning"?: string, "scope": "global"或"chat" }` | `{ "entry": SlangEntry }` |
| POST /slang/:id/reject | 无 | `{ "ok": true }` |
| POST /slang/:id/block | 无 | `{ "entry": SlangEntry }` |
| DELETE /slang/:id | 无 | `{ "ok": true }` |

给定 chatId 时，三个列表都只返回全局条目及该会话条目。confirm 到 chat 时使用已有的来源 chatId；
没有来源时先 PATCH 指定。修改请求拒绝未知键，POST 手工新增不接受客户端自定 id/status/at。

## 设置候选

- `POST /connections`：请求 `{ "settings"?: object, "chatId"?: string }`，返回
  `{ "options": [{ "value": "", "label": "跟随当前会话的连接" }, { "value": "连接ID", "label": "连接名" }] }`。
- `POST /models`：相同请求结构，草稿 settings.connectionId 优先于保存值。返回
  `{ "options": [{ "value": "模型ID", "label": "模型ID" }] }`。
  跟随会话时支持配置档连接，复用内置 caption 的连接解析及 `llm/openai.listModels`，不会暴露密钥。

## 错误

扩展路由统一返回 `{ "error": { "code": string, "message": string } }`，message 随界面语言翻译。

| code | HTTP | 含义 |
| --- | --- | --- |
| INVALID_INPUT | 400 | 参数或 JSON 格式无效 |
| CHAT_DISABLED | 400 | 会话未启用，不能 probe/lurk |
| DUPLICATE | 400 | 黑话已存在（包括 pending/blocked） |
| NOT_FOUND | 404 | 会话或黑话不存在 |
| GENERATING | 409 | 正在生成，手动试探被拒绝 |
| TRIGGER_REFUSED | 409 | 宿主房间规则拒绝手动试探 |
| INTERNAL_ERROR | 500 | 其他宿主/模型候选错误 |

自动评估遇到生成锁或宿主拒绝时静默跳过，不消耗额度，下个 tick 重试。
全局扩展被禁用/未批准时由宿主直接拒绝请求，宿主自己的错误格式不在本扩展控制范围内。

## 运行与验证说明

- `server.ts` 只做接线。`runtime.ts` 导出 `createRuntime(ctx, { complete?, random?, signal? })`，其 `tickOnce(now)`
  是内部测试入口，不暴露测试 HTTP 接口。后台 30 秒逐会话顺序评估、定时器 unref，abort 清理定时器并中止提取。
- 提取使用可注入 complete 测试接缝，生产仍走 ctx.host.complete；同一会话不并发提取，解析失败记录错误并丢弃。
- beforePrompt 用 BuildInput.history 的正文和最近 30/scanDepth 条窗口；用同步 getChatInfo(..., 50) 校正显示名，
  因为宿主在部分 meta.name / author 场景的回退次序不同。只从 user 消息选取印象注入对象。
- 设置描述的 label/hint/选项 label 使用扩展自身 t() 的属性 getter。宿主加载时会浅拷贝扩展对象，
  字段数组内的 getter 仍保留，translateSettingsSchema 每次读取 DTO 时动态翻译，中英文切换无需重载。
- tsconfig 沿用独立扩展配置结构，lib 使用宿主相同的 ES2023，依赖 Bun 提供 Web API 类型，避免额外 DOM 库与 Bun 类型冲突。
