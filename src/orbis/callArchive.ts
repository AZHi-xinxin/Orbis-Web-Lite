import { localTimestamp } from './clock.js'
import { type Message, type State, type VoiceSession, type Window, windowOf } from './core.js'

export function beginVoiceSession(s: State, window: string, id: string, at = Date.now()) {
  const w = windowOf(s, window)
  w.voiceSessions ??= []
  if (w.voiceSessions.some((c) => c.id === id)) return
  w.voiceSessions.push({ id, startedAt: at, status: 'active', summaryStatus: 'pending' })
  const invite = w.messages.find((m) => m.voiceCall?.id === id)
  if (invite) invite.voiceSessionId = id
}

/** Snapshot only after the last generation has settled; never remove or rewrite chat/tool history. */
export function finishVoiceSession(s: State, window: string, id: string, endedAt = Date.now()) {
  const w = windowOf(s, window)
  const call = w.voiceSessions?.find((c) => c.id === id)
  if (!call || call.status === 'ended') return call
  call.status = 'ended'
  call.endedAt = Math.max(call.startedAt, endedAt)
  call.raw = structuredClone(w.messages.filter((m) => m.voiceSessionId === id))
  call.summaryStatus = callTranscript(call).trim() ? 'pending' : 'empty'
  return call
}

export function callTranscript(call: VoiceSession): string {
  return (call.raw ?? []).filter((m) => !m.retracted && !m.voiceCall && m.role !== 'tool' && m.text.trim())
    .map((m) => `[${localTimestamp(m.at, 'UTC')}] ${m.role === 'user' ? '人类' : 'AI'}：${m.text}`).join('\n\n')
}

/** UI projection only. The durable messages remain untouched, including signed tool history. */
export function callDisplayMessages(w: Window, messages: Message[]): Message[] {
  const calls = new Map((w.voiceSessions ?? []).map((c) => [c.id, c]))
  const displayed = new Set<string>()
  const result: Message[] = []
  const card = (c: VoiceSession): Message => ({ id: 'call-card-' + c.id, turn: c.id,
    role: 'assistant', text: '', at: c.startedAt, voiceSessionEnd: c.id })
  for (const message of messages) {
    const c = message.voiceSessionId ? calls.get(message.voiceSessionId) : undefined
    if (!c) result.push(message)
    else if (!displayed.has(c.id)) { result.push(card(c)); displayed.add(c.id) }
  }
  for (const c of calls.values()) if (!displayed.has(c.id)) result.push(card(c))
  return result.sort((a,b) => a.at - b.at)
}

export function callDuration(c: VoiceSession, now = Date.now()) {
  const seconds = Math.floor(Math.max(0, (c.endedAt ?? now) - c.startedAt) / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
