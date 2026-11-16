import { windowOf, type Message } from './core.js'
import { readState, transact, secret } from './storage.js'
import { speechSettings, speechCredential, synthesizeSpeech } from './speech.js'
import { endBoundCall, requestIncoming } from './voiceHost.js'

const dataURL = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(Error('无法保存音频'))
    reader.readAsDataURL(blob)
  })
export async function executeVoice(
  window: string,
  turn: string,
  toolCall: string,
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
  bound?: string
): Promise<unknown> {
  const state = await readState(),
    cfg = speechSettings(state.settings)
  const id = 'voice:' + turn + ':' + toolCall
  const previous = windowOf(state, window).messages.find((m) => m.id === id)
  if (previous) {
    return { status: 'already_recorded', message_id: id, message: '按已有记录核对，不重新执行' }
  }
  if (name === 'end_voice_call') {
    if (args.call_id && args.call_id !== bound) {
      throw Error('此电话不属于当前轮次')
    }
    return endBoundCall(window, bound)
  }
  const base: Message = { id, turn, role: 'assistant', text: '', at: Date.now(), status: 'done' }
  if (name === 'orbis_voice_note') {
    if (!cfg.allowVoiceNotes) {
      throw Error('人类尚未开启允许 AI 发语音条')
    }
    if (typeof args.text !== 'string') {
      throw Error('需要语音正文 text')
    }
    const blob = await synthesizeSpeech(args.text, state.settings, signal)
    const data = await dataURL(blob)
    await transact((s) => {
      if (signal.aborted || !speechSettings(s.settings).allowVoiceNotes) {
        throw Error('已取消语音条发送')
      }
      windowOf(s, window).messages.push({
        ...base,
        text: args.text as string,
        voiceNote: true,
        files: [{ id, name: 'AI语音.wav', mime: 'audio/wav', size: blob.size, data }],
      })
    })
    return {
      status: 'sent',
      message_id: id,
      transcript: args.text,
      autoplay: false,
      heard: 'unknown',
    }
  }
  if (name !== 'start_voice_call') {
    throw Error('未知语音工具')
  }
  if (!cfg.allowIncomingCalls) {
    throw Error('人类尚未开启允许 AI 来电')
  }
  if (
    typeof args.reason !== 'string' ||
    !args.reason.trim() ||
    Array.from(args.reason).length > 2000
  ) {
    throw Error('需要 1–2000 字的邀请原因')
  }
  const seconds = args.max_ring_seconds ?? 30
  if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 5 || seconds > 60) {
    throw Error('等待接听时间为 5–60 秒')
  }
  if ((state.settings.incomingCallCooldownUntil ?? 0) > Date.now()) {
    throw Error('上次来电未接听或被拒绝，请等 15 分钟后再考虑邀请')
  }
  if (windowOf(state, window).messages.some((m) => m.turn === turn && m.voiceCall)) {
    throw Error('本轮已邀请过，不重复呼叫')
  }
  if (!secret('api')) {
    throw Error('聊天密钥尚未配置')
  }
  speechCredential(state.settings, 'asr')
  if (cfg.ttsProvider === 'deepseek') {
    speechCredential(state.settings, 'tts')
  }
  await transact((s) =>
    windowOf(s, window).messages.push({
      ...base,
      text: args.reason as string,
      voiceCall: { id, reason: args.reason as string, status: 'waiting' },
    })
  )
  const status = await requestIncoming(
    { id, window, turn, reason: args.reason, deadline: Date.now() + seconds * 1000 },
    signal
  )
  await transact((s) => {
    const message = windowOf(s, window).messages.find((m) => m.id === id)
    if (message?.voiceCall) {
      message.voiceCall.status = status
    }
    if (status === 'rejected' || status === 'no_response') {
      s.settings.incomingCallCooldownUntil = Date.now() + 15 * 60 * 1000
    }
  })
  return {
    status,
    call_id: id,
    microphone_started: false,
    message:
      status === 'accepted'
        ? '人类已接听。请简短说开场白，当前回复完成后开始语音通话。'
        : '没有建立通话，不要自动重拨。',
  }
}
