import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 扩展安装位置不固定，始终复用启动目录对应的宿主服务单例。 */
function sourceRoot() {
  let dir = process.cwd()
  while (true) {
    if (existsSync(join(dir, 'apps/server/src/db/client.ts'))) return join(dir, 'apps/server/src')
    const parent = dirname(dir)
    if (parent === dir) throw new Error('AI-Parter source tree was not found from the working directory')
    dir = parent
  }
}
const root = sourceRoot()
const settings: typeof import('../../apps/server/src/services/settings') = await import(
  pathToFileURL(join(root, 'services/settings.ts')).href
)
const connections: typeof import('../../apps/server/src/services/connections') = await import(
  pathToFileURL(join(root, 'services/connections.ts')).href
)
const chats: typeof import('../../apps/server/src/services/chats') = await import(
  pathToFileURL(join(root, 'services/chats.ts')).href
)
export const getLanguage = settings.getLanguage
export const listApiPresets = connections.listApiPresets
export const listChats = chats.listChats
/** 模型候选与内置图片说明复用连接解析及模型发现，保证跟随会话时也考虑配置档。 */
export async function listCaptionModels(connectionId: string, chatId?: string): Promise<string[]> {
  const caption: typeof import('../../apps/server/src/extensions/builtin/caption') = await import(
    pathToFileURL(join(root, 'extensions/builtin/caption/index.ts')).href
  )
  const llm: typeof import('../../apps/server/src/llm/openai') = await import(
    pathToFileURL(join(root, 'llm/openai.ts')).href
  )
  const connection = caption.resolveCaptionConnection(
    { connectionId, model: '', prompt: '', alwaysText: false },
    chatId,
  )
  return llm.listModels(llm.toLlmConnection(connection))
}
