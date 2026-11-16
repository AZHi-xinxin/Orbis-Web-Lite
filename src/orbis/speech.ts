import type { State } from './core.js'
import { secret } from './storage.js'
import { preparePlayback, playSpeechBlob, releasePlayback, type PlaybackGate } from './speechPlayback.js'
export type SpeechSettings = {
  asrEndpoint: string
  ttsEndpoint: string
  asrReuseModelKey: boolean
  ttsReuseModelKey: boolean
  ttsProvider: 'browser' | 'deepseek'
  voice: 'stella' | 'tide'
  autoSend: boolean
  allowVoiceNotes?: boolean
  allowIncomingCalls?: boolean
}
export const speechSettings = (s: State['settings']): SpeechSettings => ({
  asrEndpoint: 'https://api.deepseek.com',
  ttsEndpoint: 'https://api.deepseek.com',
  asrReuseModelKey: true,
  ttsReuseModelKey: true,
  ttsProvider: 'browser',
  voice: 'stella',
  autoSend: true,
  allowVoiceNotes: false,
  allowIncomingCalls: false,
  ...s.speech,
})
export function speechURL(endpoint: string, kind: 'asr' | 'tts'): string {
  const u = new URL(endpoint)
  if (
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    (u.protocol !== 'https:' &&
      !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)))
  )
    throw Error('语音接口请使用不含密钥和查询参数的 HTTPS 基础地址')
  return endpoint.replace(/\/$/, '').replace(/\/(?:anthropic\/)?v1$/, '') + '/v1/tools/' + kind
}
export function speechCredential(
  s: State['settings'],
  kind: 'asr' | 'tts',
  getSecret = secret
): { url: string; key: string } {
  const cfg = speechSettings(s),
    url = speechURL(kind === 'asr' ? cfg.asrEndpoint : cfg.ttsEndpoint, kind)
  const reuse = kind === 'asr' ? cfg.asrReuseModelKey : cfg.ttsReuseModelKey
  if (reuse && new URL(url).origin !== new URL(s.endpoint).origin)
    throw Error('语音和聊天服务地址不同，请关闭“复用聊天密钥”并填写该语音服务的密钥')
  const key = getSecret(reuse ? 'api' : kind)
  if (!key)
    throw Error('请先在语音设置填写或选择复用 ' + (kind === 'asr' ? 'ASR' : 'TTS') + ' 密钥')
  return { url, key }
}
async function checked(response: Response) {
  if (!response.ok) throw Error(`语音接口返回 ${response.status}，请检查密钥、余额与接口地址`)
  return response
}
/** Create a saved voice message; synthesis is separate from playback and never auto-retried. */
export async function synthesizeSpeech(
  text: string,
  settings: State['settings'],
  signal: AbortSignal
): Promise<Blob> {
  const cfg = speechSettings(settings)
  if (cfg.ttsProvider !== 'deepseek') {
    throw Error('语音条需要 DeepSeek TTS；系统朗读不能生成可保存的音频')
  }
  if (!text.trim() || Array.from(text).length > 2000) {
    throw Error('每条语音正文需为 1–2000 字')
  }
  const { url, key } = speechCredential(settings, 'tts')
  const response = await checked(
    await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice_id: cfg.voice, format: 'wav', filter_markdown: true }),
      signal,
    })
  )
  const data = await response.arrayBuffer()
  const bytes = new Uint8Array(data)
  if (
    bytes.length < 44 ||
    bytes.length > 20 * 1024 * 1024 ||
    String.fromCharCode(...bytes.slice(0, 4)) !== 'RIFF' ||
    String.fromCharCode(...bytes.slice(8, 12)) !== 'WAVE'
  ) {
    throw Error('TTS 没有返回有效的 WAV 音频，未生成语音条')
  }
  if (signal.aborted) throw new DOMException('已停止', 'AbortError')
  return new Blob([data], { type: 'audio/wav' })
}
export async function transcribeSpeech(
  s: State['settings'],
  blob: Blob,
  signal: AbortSignal
): Promise<string> {
  const { url, key } = speechCredential(s, 'asr')
  if (blob.size > 8 * 1024 * 1024) throw Error('ASR 单段录音不能超过 8 MiB')
  const form = new FormData()
  form.append('file', blob, 'recording.wav')
  const body = await (
    await checked(
      await fetch(url, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key },
        body: form,
        signal,
      })
    )
  ).json()
  if (typeof body.text !== 'string' || !body.text.trim())
    throw Error('没有识别到可发送的文字，请重新录音')
  return body.text
}
let current: { controller: AbortController; cancel: () => void } | undefined
/** Called synchronously from a tap, before microphone/network awaits. */
export function prepareSpeech() {
  preparePlayback()
  if ('speechSynthesis' in window && !current) {
    const warmup = new SpeechSynthesisUtterance(' ')
    warmup.volume = 0
    warmup.onerror = () => {}
    speechSynthesis.speak(warmup)
  }
}
export function stopSpeech() {
  current?.controller.abort()
  current?.cancel()
  current = undefined
}
export const speechChunks = (text: string) => {
  const chars = Array.from(text)
  const chunks: string[] = []
  while (chars.length) chunks.push(chars.splice(0, 2000).join(''))
  return chunks
}
export async function speakText(
  text: string,
  settings: State['settings'],
  outer?: AbortSignal,
  onPlaying?: () => void,
  gate?: PlaybackGate
): Promise<void> {
  stopSpeech()
  const controller = new AbortController(),
    signal = controller.signal
  const abort = () => controller.abort()
  if (outer?.aborted) throw new DOMException('已停止', 'AbortError')
  outer?.addEventListener('abort', abort, { once: true })
  current = { controller, cancel: () => {} }
  const cfg = speechSettings(settings)
  try {
    if (cfg.ttsProvider === 'browser') {
      if (!('speechSynthesis' in window)) throw Error('此浏览器没有系统朗读，请选择 DeepSeek TTS')
      await new Promise<void>((resolve, reject) => {
        let finished = false, attempt = 0
        const finish = (error?: Error) => {
          if (finished) { return }
          finished = true
          signal.removeEventListener('abort', cancel)
          gate?.(undefined)
          error ? reject(error) : resolve()
        }
        const cancel = () => { attempt++; speechSynthesis.cancel(); finish() }
        const speak = () => {
          if (finished || signal.aborted) { return }
          const id = ++attempt
          speechSynthesis.cancel()
          const utterance = new SpeechSynthesisUtterance(text)
          utterance.lang = 'zh-CN'
          utterance.onstart = () => { if (id === attempt && !finished) { gate?.(undefined); onPlaying?.() } }
          utterance.onend = () => { if (id === attempt) { finish() } }
          utterance.onerror = (event) => {
            if (id !== attempt || finished) { return }
            if (signal.aborted) { finish() }
            else if (event.error === 'not-allowed' && gate) { gate(speak) }
            else { finish(Error('系统朗读失败，可在语音设置选择 DeepSeek TTS')) }
          }
          speechSynthesis.speak(utterance)
        }
        current!.cancel = cancel
        signal.addEventListener('abort', cancel, { once: true })
        speak()
      })
    } else {
      const { url, key } = speechCredential(settings, 'tts')
      for (const chunk of speechChunks(text)) {
        if (signal.aborted) break
        const response = await checked(
          await fetch(url, {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: chunk,
              voice_id: cfg.voice,
              format: 'wav',
              filter_markdown: true,
            }),
            signal,
          })
        )
        const blob = await response.blob()
        if (signal.aborted) break
        await playSpeechBlob(blob, signal, onPlaying, gate)
      }
    }
    if (signal.aborted) {
      throw new DOMException('已停止', 'AbortError')
    }
  } finally {
    outer?.removeEventListener('abort', abort)
    if (current?.controller === controller) current = undefined
  }
}
export function releaseSpeech() {
  stopSpeech()
  releasePlayback()
}
