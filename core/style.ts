/**
 * 群聊规则：只管「在群里怎么说」，角色自己的语气（口头禅、标点、emoji、话多话少）以角色卡为准。
 * 参考 qq-bridge 二代预设的「分条与节奏」「学习群友策略」，改写成英文指令。
 */
export const DEFAULT_STYLE_HINT = [
  "You are chatting in a group chat as one of its members. Your character's own voice (catchphrases, punctuation, emoji, how talkative they are) always comes first; the rules below are only group-chat defaults.",
  '- Type like a chat message, not an essay. One line carries one idea; keep most lines short (about 30 characters, or 15 words).',
  '- Usually send one line, at most two; only storytelling or a punchline may take two to four. Put each line on its own line, separated by a single line break with no blank lines, and never split one sentence across two lines.',
  "- Don't use spaces to fake pauses inside a line; use punctuation or just keep writing.",
  "- You don't need to answer every point or address everyone. A one-word reaction is often better than a forced reply.",
  "- If you just spoke and nobody picked it up, don't add another line unless you have something new.",
  '- Watch how this group talks (message length, slang, tone, when people stay quiet) and blend in without copying or echoing anyone.',
  '- Never mention being an AI or being prompted.',
].join('\n')

/** 统计节奏需要的最少真人消息数：太少时中位数没有意义。 */
const MIN_SAMPLES = 5
/** 「一两个字的反应」的字数上限。 */
const REACTION_CHARS = 4

/**
 * 按最近真人消息的长度给一句节奏参考。字数按字符（Array.from）算，中英文都只是粗略参考。
 * 样本不足返回空串。
 */
export function rhythmHint(texts: string[]): string {
  const lengths = texts
    .map((text) => Array.from(text.trim()).length)
    .filter((length) => length > 0)
    .sort((a, b) => a - b)
  if (lengths.length < MIN_SAMPLES) return ''
  const median = lengths[Math.floor(lengths.length / 2)]!
  const reactions = lengths.filter((length) => length <= REACTION_CHARS).length / lengths.length
  return [
    `Group rhythm: members' recent messages are about ${median} characters long (median).`,
    reactions >= 0.3 ? 'Short reactions of a word or two are common here.' : '',
    'Loosely match this rhythm.',
  ]
    .filter(Boolean)
    .join(' ')
}

/** 超过这个分钟数，最新消息就算「旧账」，不能再用秒回语气。 */
export const STALE_MINUTES = 30
/** 超过这个分钟数，话题多半已经散了。 */
const COLD_MINUTES = 180

/** 最新一条真人消息过了很久才回时，提醒别用「刚看到」的秒回语气。没有过期返回空串。 */
export function staleHint(minutesAgo: number): string {
  if (!(minutesAgo >= STALE_MINUTES)) return ''
  const age = minutesAgo >= 120 ? `${Math.floor(minutesAgo / 60)} hours` : `${Math.floor(minutesAgo)} minutes`
  return minutesAgo >= COLD_MINUTES
    ? `The latest message is ${age} old. Don't reply as if you just saw it, and don't treat an old topic as current; the conversation has probably moved on.`
    : `The latest message is ${age} old. Don't use real-time phrasing like "just saw this"; check whether the topic and the person are still around.`
}
