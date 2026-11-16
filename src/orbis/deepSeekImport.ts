import { LocalZip, safeZipPath } from './localZip.js'
import { JsonObjectArrayStream } from './importJson.js'
import { type Window, type Message, type State, uid } from './core.js'

type ObjectValue = Record<string, unknown>
type Node = {
  id: string
  parent: string | null
  children: string[]
  message: ObjectValue | null
  role: 'user' | 'assistant'
  at: number
  depth: number
}
type Conversation = {
  id: string
  title: string
  at: number
  nodes: Map<string, Node>
  selected: string
}
export type DeepSeekPreview = {
  id: string
  title: string
  messages: number
  selected: string
  branches: { id: string; count: number; at: number }[]
}
function requireValue(
  ok: unknown,
  message = 'DeepSeek 聊天结构不兼容或损坏；当前会话未导入'
): asserts ok {
  if (!ok) {
    throw Error(message)
  }
}
const object = (x: unknown): ObjectValue => {
  requireValue(x && typeof x === 'object' && !Array.isArray(x))
  return x as ObjectValue
}
const array = (x: unknown): unknown[] => {
  requireValue(Array.isArray(x))
  return x
}
const identity = (x: unknown) => {
  requireValue(typeof x === 'string' && x.length > 0 && !Array.from(x).some(c => c.charCodeAt(0) < 32))
  return x
}
const numericId = (x: unknown) => {
  requireValue(Number.isSafeInteger(x) && Number(x) >= 0)
  return String(x)
}
const date = (x: unknown) => {
  requireValue(typeof x === 'string')
  const n = Date.parse(x)
  requireValue(Number.isFinite(n) && n >= 0)
  return n
}
const hash = async (x: unknown) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(x)))
    )
  )
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')

export function parseDeepSeek(value: unknown): Conversation {
  const raw = object(value),
    id = identity(raw.id),
    at = date(raw.inserted_at)
  date(raw.updated_at)
  requireValue(raw.title == null || typeof raw.title === 'string')
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title : '未命名会话'
  const nodes = new Map<string, Node>()
  let selected: string | undefined
  if (Array.isArray(raw.messages)) {
    const root = '__deepseek_v3_root__'
    nodes.set(root, {
      id: root,
      parent: null,
      children: [],
      message: null,
      role: 'assistant',
      at,
      depth: 0,
    })
    for (const v of raw.messages) {
      const m = object(v),
        key = numericId(m.id),
        parent = m.parent_id === null ? root : numericId(m.parent_id)
      requireValue(!nodes.has(key))
      nodes.set(key, {
        id: key,
        parent,
        children: [],
        message: m,
        role: 'user',
        at: date(m.inserted_at),
        depth: 0,
      })
    }
    for (const node of nodes.values()) {
      if (node.parent !== null) {
        const parent = nodes.get(node.parent)
        requireValue(parent && parent !== node)
        parent.children.push(node.id)
      }
    }
    if (raw.current_message_id != null) {
      selected = numericId(raw.current_message_id)
    }
  } else {
    for (const [key, v] of Object.entries(object(raw.mapping))) {
      const n = object(v),
        parent = n.parent === null ? null : identity(n.parent),
        children = array(n.children).map(identity)
      requireValue(
        identity(n.id) === key &&
          new Set(children).size === children.length &&
          !children.includes(key) &&
          parent !== key
      )
      const m = n.message === null ? null : object(n.message)
      requireValue((m === null) === (parent === null))
      nodes.set(key, {
        id: key,
        parent,
        children,
        message: m,
        role: 'user',
        at: m ? date(m.inserted_at) : at,
        depth: 0,
      })
    }
    if (raw.current_node != null) {
      selected = identity(raw.current_node)
    }
  }
  const roots = [...nodes.values()].filter((n) => n.parent === null)
  requireValue(roots.length === 1)
  const order = [roots[0]],
    visited = new Set<string>()
  for (let i = 0; i < order.length; i++) {
    const node = order[i]
    requireValue(!visited.has(node.id))
    visited.add(node.id)
    if (node.message) {
      const fragments = array(node.message.fragments).map(object),
        types = fragments.map((f) => identity(f.type))
      const user = types.some((t) => ['REQUEST', 'FILE'].includes(t)),
        assistant = types.some((t) =>
          [
            'RESPONSE',
            'THINK',
            'SEARCH',
            'TOOL_SEARCH',
            'TOOL_OPEN',
            'TOOL_FIND',
            'TEMPLATE_RESPONSE',
            'READ_LINK',
            'PARTIAL_FILE_READ',
          ].includes(t)
        )
      requireValue(!(user && assistant))
      const role = node.message.role
      requireValue(role == null || role === 'USER' || role === 'ASSISTANT')
      node.role = role
        ? role === 'USER'
          ? 'user'
          : 'assistant'
        : user
          ? 'user'
          : assistant ||
              nodes.get(node.parent ?? '')?.role === 'user' ||
              types.some((t) => !['CONTENT_RISK', 'TIP'].includes(t))
            ? 'assistant'
            : 'user'
      node.depth = (nodes.get(node.parent ?? '')?.depth ?? 0) + 1
    }
    for (const child of node.children) {
      const n = nodes.get(child)
      requireValue(n && n.parent === node.id)
      order.push(n)
    }
  }
  requireValue(visited.size === nodes.size)
  if (selected === undefined) {
    selected = [...nodes.values()]
      .filter((n) => !n.children.length)
      .sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))[0]?.id
  }
  requireValue(selected && nodes.has(selected))
  return { id, title, at, nodes, selected }
}
const pathTo = (s: Conversation, leaf: string) => {
  let node = s.nodes.get(leaf)
  requireValue(node)
  const path: Node[] = []
  while (node) {
    if (node.message) {
      path.push(node)
    }
    node = node.parent === null ? undefined : s.nodes.get(node.parent)
  }
  return path.reverse()
}
export class DeepSeekArchive {
  private constructor(
    private zip: LocalZip,
    private prefix: string,
    private index: Map<string, ObjectValue>,
    private legacy?: string
  ) {}
  static async open(file: Blob) {
    const zip = await LocalZip.open(file)
    const names = [...zip.entries.keys()].filter((n) => !n.startsWith('__MACOSX/'))
    const indexes = names.filter((n) => n.split('/').pop() === 'chat_session_index.json')
    if (indexes.length) {
      requireValue(indexes.length === 1)
      const prefix = indexes[0].slice(0, -'chat_session_index.json'.length)
      const manifest = object(await zip.json(prefix + 'manifest.json'))
      requireValue(
        Number.isSafeInteger(manifest.export_format_version) &&
          Number(manifest.export_format_version) >= 3,
        '此 DeepSeek 导出版本尚未支持，请保留原包'
      )
      const index = new Map<string, ObjectValue>()
      for (const x of array(await zip.json(indexes[0]))) {
        const h = object(x),
          id = identity(h.id)
        requireValue(
          /^[A-Za-z0-9_-]+$/.test(id) &&
            !index.has(id) &&
            zip.entries.has(prefix + 'chat_sessions/' + id + '.json')
        )
        requireValue(Number.isSafeInteger(h.message_count) && Number(h.message_count) >= 0)
        index.set(id, h)
      }
      requireValue(index.size > 0)
      return new DeepSeekArchive(zip, prefix, index)
    }
    const entries = names.filter((n) => n.split('/').pop() === 'conversations.json')
    requireValue(
      entries.length === 1,
      '请选择 DeepSeek 官端导出 ZIP；Lite 完整备份请使用下方恢复入口'
    )
    return new DeepSeekArchive(zip, '', new Map(), entries[0])
  }
  private async legacyConversations(accept: (raw: unknown) => void) {
    requireValue(this.legacy)
    const decoder = new TextDecoder('utf-8', { fatal: true }),
      ids = new Set<string>()
    const parser = new JsonObjectArrayStream((raw) => {
      const id = identity(object(raw).id)
      requireValue(!ids.has(id))
      ids.add(id)
      accept(raw)
    })
    await this.zip.stream(this.legacy, (bytes) =>
      parser.push(decoder.decode(bytes, { stream: true }))
    )
    parser.push(decoder.decode())
    parser.finish()
    requireValue(ids.size > 0)
  }
  private async conversation(id: string) {
    let raw: unknown
    if (this.legacy) {
      await this.legacyConversations((item) => {
        if (object(item).id === id) {
          raw = item
        }
      })
    } else {
      raw = await this.zip.json(this.prefix + 'chat_sessions/' + id + '.json')
    }
    requireValue(object(raw).id === id)
    if (!this.legacy) {
      requireValue(array(object(raw).messages).length === this.index.get(id)?.message_count)
    }
    const s = parseDeepSeek(raw)
    for (const n of s.nodes.values()) {
      for (const f of array(n.message?.fragments ?? []).map(object)) {
        for (const v of array(f.files ?? [])) {
          const ref = object(v),
            path = ref.export_path
          if (path == null || path === '') {
            continue
          }
          requireValue(
            typeof path === 'string' &&
              safeZipPath(path) &&
              path.startsWith(`chat_sessions/${id}_files/`) &&
              path.split('/').length === 3
          )
          const entry = this.zip.entries.get(this.prefix + path)
          requireValue(!entry || entry.size === ref.file_size)
        }
      }
    }
    return s
  }
  async inspect(progress: (done: number, total: number) => void = () => {}) {
    const ids = [...this.index.keys()],
      result: DeepSeekPreview[] = []
    const add = (s: Conversation) => {
      result.push({
        id: s.id,
        title: s.title,
        messages: [...s.nodes.values()].filter((n) => n.message).length,
        selected: s.selected,
        branches: [...s.nodes.values()]
          .filter((n) => !n.children.length || n.id === s.selected)
          .map((n) => ({ id: n.id, count: n.depth, at: n.at })),
      })
      progress(result.length, this.legacy ? result.length : ids.length)
    }
    if (this.legacy) {
      await this.legacyConversations((raw) => add(parseDeepSeek(raw)))
    } else {
      for (const id of ids) {
        add(await this.conversation(id))
      }
    }
    return result
  }
  async prepare(id: string, leaf: string, media: boolean) {
    const s = await this.conversation(id),
      path = pathTo(s, leaf)
    requireValue(s.nodes.get(leaf)?.children.length === 0 || leaf === s.selected)
    const digest = await hash([id, leaf, path.map((n) => n.message), media])
    const windowId = 'deepseek-' + (await hash([id, leaf]))
    const w: Window = {
      id: windowId,
      title: s.title,
      mode: 'standard',
      at: s.at,
      messages: [],
      compressions: [],
      importKey: 'deepseek/' + digest,
    }
    let attachments = 0,
      restored = 0,
      mediaBytes = 0
    const savedMedia = new Map<string, NonNullable<Message['files']>[number]>()
    for (const n of path) {
      const text: string[] = [],
        thinking: string[] = [],
        files: NonNullable<Message['files']> = []
      for (const f of array(n.message?.fragments).map(object)) {
        if (
          ['REQUEST', 'RESPONSE', 'THINK'].includes(String(f.type)) &&
          typeof f.content === 'string'
        ) {
          ;(f.type === 'THINK' ? thinking : text).push(f.content)
        } else if (f.type === 'FILE' && Array.isArray(f.files) && f.files.length) {
          for (const v of f.files) {
            const ref = object(v),
              p = ref.export_path
            attachments++
            const name = typeof ref.file_name === 'string' ? ref.file_name : '历史附件'
            const mime = (
              {
                jpg: 'image/jpeg',
                jpeg: 'image/jpeg',
                png: 'image/png',
                webp: 'image/webp',
                gif: 'image/gif',
                mp3: 'audio/mpeg',
                wav: 'audio/wav',
                m4a: 'audio/mp4',
                ogg: 'audio/ogg',
              } as Record<string, string>
            )[name.split('.').pop()?.toLowerCase() ?? '']
            if (media && mime && typeof p === 'string' && this.zip.entries.has(this.prefix + p)) {
              let file = savedMedia.get(p)
              if (!file) {
                mediaBytes += this.zip.entries.get(this.prefix + p)?.size ?? 0
                requireValue(
                  mediaBytes <= 64 * 1024 * 1024,
                  '此会话图片与音频超过 64 MiB，请取消勾选附件后导入文字；原件仍在 ZIP 中'
                )
                const bytes = await this.zip.read(this.prefix + p, 16 * 1024 * 1024)
                let binary = ''
                for (let i = 0; i < bytes.length; i += 32768) {
                  binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
                }
                file = {
                  id: await hash([id, p]),
                  name,
                  mime,
                  data: `data:${mime};base64,${btoa(binary)}`,
                  size: bytes.length,
                }
                savedMedia.set(p, file)
              }
              files.push(file)
              restored++
            } else {
              text.push('[历史附件引用；原件请保留在原 ZIP，未联网下载]\n' + JSON.stringify(ref))
            }
          }
        } else {
          text.push('[DeepSeek 历史记录；未执行]\n' + JSON.stringify(f))
        }
      }
      w.messages.push({
        id: 'ds-' + n.id,
        turn: 'ds-' + n.id,
        role: n.role,
        text: text.join('\n'),
        at: n.at,
        status: 'done',
        ...(thinking.length ? { reasoning: thinking.join('\n') } : {}),
        ...(files.length ? { files } : {}),
      })
    }
    return { window: w, attachments, restored }
  }
}
/** A single conversation is committed atomically; exact repeated imports are skipped. */
export function appendDeepSeek(state: State, source: Window) {
  if (state.windows.some((w) => w.importKey === source.importKey)) {
    return false
  }
  const w = structuredClone(source)
  if (state.windows.some((x) => x.id === w.id)) {
    w.id = uid()
  }
  // Prefix identities with the final window id so separate branches never share turn ids.
  for (const m of w.messages) {
    m.id = w.id + '/' + m.id
    m.turn = w.id + '/' + m.turn
  }
  state.windows.push(w)
  return true
}
