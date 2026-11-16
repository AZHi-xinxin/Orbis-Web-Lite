import { compact, newWindow, uid, windowOf, type Message, type State, type Window } from './core.js'

export function assertIdle(w: Window) {
  if (w.messages.some(m => m.status === 'working') || w.voiceSessions?.some(c => c.status === 'active'))
    throw Error('请先结束正在进行的回复或通话')
}

/** Fork at a whole-turn boundary, keeping signed tool history intact and never executing it. */
export function forkWindow(s: State, id: string, message?: string): Window {
  const source = windowOf(s, id)
  assertIdle(source)
  let end = message ? source.messages.findIndex(m => m.id === message) + 1 : source.messages.length
  if (!end) throw Error('没有可开启分支的消息')
  while (end < source.messages.length && source.messages[end].turn === source.messages[end - 1].turn) end++
  const messages = structuredClone(source.messages.slice(0, end))
  const calls = structuredClone((source.voiceSessions ?? []).filter(c => c.status === 'ended' &&
    (end === source.messages.length || (c.endedAt ?? Infinity) <= source.messages[end - 1].at)))
  const ids = new Map(messages.map(m => [m.id, uid()]))
  const turns = new Map(messages.map(m => [m.turn, uid()]))
  const voiceIds = new Map([...messages.flatMap(m => m.voiceSessionId ? [m.voiceSessionId] : []), ...calls.map(c => c.id)].map(id => [id, uid()]))
  for (const m of calls.flatMap(c => c.raw ?? [])) {
    if (!ids.has(m.id)) ids.set(m.id, uid())
    if (!turns.has(m.turn)) turns.set(m.turn, uid())
  }
  const branch: Window = { ...newWindow(source.title + ' · 分支', source.mode), messages,
    conversation: structuredClone(source.conversation),
    forkedFrom: { window: id, message: source.messages[end - 1].id, at: Date.now() } }
  for (const m of [...messages, ...calls.flatMap(c => c.raw ?? [])]) {
    m.id = ids.get(m.id)!; m.turn = turns.get(m.turn)!
    if (m.quoteId) m.quoteId = ids.get(m.quoteId) ?? m.quoteId
    if (m.voiceSessionId) m.voiceSessionId = voiceIds.get(m.voiceSessionId)
    if (m.voiceSessionEnd) m.voiceSessionEnd = voiceIds.get(m.voiceSessionEnd)
    if (m.voiceCall && voiceIds.has(m.voiceCall.id)) m.voiceCall.id = voiceIds.get(m.voiceCall.id)!
  }
  branch.voiceSessions = calls
  for (const c of branch.voiceSessions ?? []) c.id = voiceIds.get(c.id)!
  // Light mode stays isolated, with a private copy of its existing notes.
  const notes = source.mode === 'light' ? s.notes.filter(n => n.window === id) : []
  const noteIds = new Map(notes.map(n => [n.id, uid()]))
  s.notes.push(...notes.map(n => ({ ...structuredClone(n), id: noteIds.get(n.id)!, window: branch.id, importKey: undefined })))
  s.turns.push(...s.turns.filter(t => t.window === id && turns.has(t.id)).map(t => ({
    ...structuredClone(t), id: turns.get(t.id)!, window: branch.id,
    selection: t.selection.map(e => ({ ...e, id: noteIds.get(e.id) ?? e.id }))
  })))
  s.windows.push(branch)
  return branch
}

export function compactionCut(messages: Message[], keep: number): number {
  if (!Number.isInteger(keep) || keep < 0 || keep > messages.length) throw Error('保留数量超出当前消息范围')
  let cut = messages.length - keep
  while (cut > 0 && cut < messages.length && messages[cut].turn === messages[cut - 1].turn) cut--
  return cut
}

/** No image/audio encodings or executable tool blocks in the summarizing request. */
export function compactionText(messages: Message[]): string {
  return messages.map(m => {
    if (m.retracted) return `[${m.role}]（已撤回）`
    return `[${m.role} · ${new Date(m.at).toISOString()}${m.status === 'error' ? ' · 请求错误，非正常AI回复' : ''}]\n${m.text}` +
      (m.thought ? '\n人类附注：' + m.thought : '') +
      (m.calls?.length ? '\n历史工具调用（勿执行）：' + JSON.stringify(m.calls) : '') +
      (m.files ?? []).map(f => '\n附件 ' + f.name + (f.mime.startsWith('text/') ? '：' + f.data : '（仅保留附件引用，未读取媒体内容）')).join('')
  }).join('\n\n')
}

export function summaryChunks(text: string, size: number): string[] {
  if (!Number.isInteger(size) || size < 2000 || size > 48000) throw Error('分段大小范围为 2000–48000 字符')
  const result: string[] = []
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(text.length, offset + size)
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--
    result.push(text.slice(offset, end)); offset = end
  }
  return result
}

export function applyManualCompaction(s: State, id: string, originals: Message[], summary: string, keep: number,
  segments?: string[]) {
  const w = windowOf(s, id)
  assertIdle(w)
  if (JSON.stringify(w.messages) !== JSON.stringify(originals)) throw Error('聊天已变化，请重新打开压缩面板生成或核对摘要')
  if (!segments && summary.length > 65536) throw Error('单份摘要上限为65,536字符；较长内容请使用保留各段摘要模式')
  if (segments && (!segments.length || segments.some(p => !p.trim() || p.length > 24000)))
    throw Error('分段摘要不完整，未应用压缩')
  const event = compact(s, id, summary, keep, undefined, 'human')
  if (segments) {
    const template = s.notes.find(n => n.id === event.noteId)!
    s.notes = s.notes.filter(n => n.id !== event.noteId)
    delete event.noteId
    event.segments = segments.map(body => {
      const noteId = uid()
      s.notes.push({ ...template, id: noteId, body, history: [], tags: [] })
      return { noteId, summary: body }
    })
  }
  return event
}
