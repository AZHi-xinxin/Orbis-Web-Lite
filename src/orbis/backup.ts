import { strToU8, strFromU8, zipSync, unzipSync } from 'fflate'
import { displayText, uid, type State, type Message, type Window } from './core.js'
export const universalChat = (s: State) => ({
  format: 'orbis_chat',
  version: 1,
  conversations: s.windows
    .filter((w) => w.messages.length)
    .map((w) => ({
      id: 'orbis-web/' + w.id,
      title: w.title,
      messages: w.messages.map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content:
          m.role === 'tool'
            ? '[历史工具结果，仅供阅读]\n' + m.text
            : displayText(s, w, m) +
              (m.calls?.length ? '\n[历史工具调用，仅供阅读]\n' + JSON.stringify(m.calls) : '') +
              (m.files?.length
                ? '\n[附件原件请另存] ' + m.files.map((f) => f.name).join('、')
                : ''),
        ...(m.reasoning ? { reasoning: m.reasoning } : {}),
        timestamp: new Date(m.at).toISOString(),
      })),
    })),
})
export function fullBackup(s: State): Uint8Array {
  const copy = structuredClone(s)
  copy.sentinels.forEach((r) => {
    r.enabled = false
    delete r.receipt
  })
  copy.settings.sentinelEnabled = false
  return zipSync({
    'manifest.json': strToU8(
      JSON.stringify({
        format: 'orbis_web_lite',
        version: 1,
        created_at: new Date().toISOString(),
        android_compatibility: '请用单独的 Orbis 通用聊天导出；完整包 Android 导入器尚未提供',
      })
    ),
    'state.json': strToU8(JSON.stringify(copy)),
  })
}
export function restoreBackup(
  current: State,
  bytes: Uint8Array
): { windows: number; notes: number } {
  if (bytes.length > 128 * 1024 * 1024) throw Error('实验版单包上限 128 MiB')
  let expanded = 0
  const data = unzipSync(bytes, {
    filter: (f) => {
      if (!['manifest.json', 'state.json'].includes(f.name)) throw Error('备份包含未知文件')
      expanded += f.originalSize
      if (expanded > 256 * 1024 * 1024) throw Error('解压内容过大')
      return true
    },
  })
  const manifest = JSON.parse(strFromU8(data['manifest.json'] ?? new Uint8Array()))
  if (manifest.format !== 'orbis_web_lite' || manifest.version !== 1)
    throw Error('不是此版本的 Orbis Web 完整备份')
  const s = JSON.parse(strFromU8(data['state.json'] ?? new Uint8Array())) as State
  validateState(s)
  const fingerprint = (x: unknown) => {
    const text = JSON.stringify(x)
    let a = 2166136261,
      b = 5381
    for (let i = 0; i < text.length; i++) {
      a = Math.imul(a ^ text.charCodeAt(i), 16777619)
      b = Math.imul(b, 33) ^ text.charCodeAt(i)
    }
    return (a >>> 0).toString(16) + (b >>> 0).toString(16)
  }
  const existing = new Map(current.windows.map((w) => [w.id, JSON.stringify(w)])),
    map = new Map<string, string>(),
    noteMap = new Map<string, string>(),
    addedWindows: Window[] = []
  let windows = 0,
    notes = 0
  for (const w of s.windows) {
    const signature = w.id + ':' + fingerprint(w)
    const imported = current.windows.find((x) => x.importKey === signature)
    if (imported) {
      map.set(w.id, imported.id)
      continue
    }
    const prior = existing.get(w.id)
    if (prior === JSON.stringify(w)) {
      map.set(w.id, w.id)
      continue
    }
    const id = prior ? uid() : w.id
    map.set(w.id, id)
    w.id = id
    w.importKey = signature
    current.windows.push(w)
    addedWindows.push(w)
    windows++
  }
  for (const n of s.notes) {
    const sourceId = n.id,
      signature = n.id + ':' + fingerprint(n),
      imported = current.notes.find((x) => x.importKey === signature)
    if (imported) {
      noteMap.set(sourceId, imported.id)
      continue
    }
    const same = current.notes.find((x) => x.id === n.id)
    if (
      same &&
      JSON.stringify(same) === JSON.stringify(n) &&
      same.window === (map.get(n.window) ?? n.window)
    ) {
      noteMap.set(sourceId, same.id)
      continue
    }
    if (same) n.id = uid()
    n.window = map.get(n.window) ?? n.window
    noteMap.set(sourceId, n.id)
    n.importKey = signature
    current.notes.push(n)
    notes++
  }
  for (const w of addedWindows)
    for (const e of w.compressions) {
      if (e.backupId) e.backupId = map.get(e.backupId) ?? e.backupId
      if (e.noteId) e.noteId = noteMap.get(e.noteId) ?? e.noteId
    }
  // Do not import tasks, credentials or runtime turns. Existing settings are preserved.
  return { windows, notes }
}
function validateState(s: State) {
  if (
    s.version !== 1 ||
    !Array.isArray(s.windows) ||
    !Array.isArray(s.notes) ||
    s.windows.length > 10000 ||
    s.notes.length > 100000
  )
    throw Error('备份格式或数量不合法')
  const ids = new Set<string>()
  for (const w of s.windows) {
    if (
      typeof w.id !== 'string' ||
      ids.has(w.id) ||
      typeof w.title !== 'string' ||
      !['light', 'standard', 'independent'].includes(w.mode) ||
      !Array.isArray(w.messages) ||
      !Array.isArray(w.compressions)
    )
      throw Error('窗口格式错误')
    ids.add(w.id)
    for (const m of w.messages) validateMessage(m)
    if (w.rollback) {
      if (!Array.isArray(w.rollback.originals)) throw Error('回退点格式错误')
      w.rollback.originals.forEach(validateMessage)
    }
  }
  for (const n of s.notes)
    if (
      typeof n.id !== 'string' ||
      !ids.has(n.window) ||
      typeof n.body !== 'string' ||
      typeof n.summary !== 'string' ||
      !Array.isArray(n.history) ||
      !Array.isArray(n.tags) ||
      !['static', 'conditional', 'pinned', 'paused'].includes(n.state)
    )
      throw Error('记忆格式错误')
}
function validateMessage(m: Message) {
  if (
    typeof m.id !== 'string' ||
    typeof m.text !== 'string' ||
    !['user', 'assistant', 'tool'].includes(m.role) ||
    !Number.isFinite(m.at)
  )
    throw Error('消息格式错误')
  for (const f of m.files ?? [])
    if (
      typeof f.data !== 'string' ||
      !/^data:(image\/(png|jpeg|webp|gif)|audio\/[\w.+-]+|text\/plain)[;,]/.test(f.data)
    )
      throw Error('附件类型不支持')
}
export function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
