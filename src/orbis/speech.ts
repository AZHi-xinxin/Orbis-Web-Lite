import type { State } from './core.js'
import { secret } from './storage.js'
export type SpeechSettings = {
  asrEndpoint: string
  ttsEndpoint: string
  asrReuseModelKey: boolean
  ttsReuseModelKey: boolean
  ttsProvider: 'browser' | 'deepseek'
  voice: 'stella' | 'tide'
  autoSend: boolean
}
export const speechSettings = (s: State['settings']): SpeechSettings => ({
  asrEndpoint: 'https://api.deepseek.com',
  ttsEndpoint: 'https://api.deepseek.com',
  asrReuseModelKey: true,
  ttsReuseModelKey: true,
  ttsProvider: 'browser',
  voice: 'stella',
  autoSend: true,
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
let context: AudioContext | undefined
let current: { controller: AbortController; cancel: () => void } | undefined
/** Called synchronously from a tap before awaiting microphone/network permissions (iOS). */
export function prepareSpeech() {
  if (!context || context.state === 'closed') context = new AudioContext()
  if (context.state === 'suspended') void context.resume().catch(() => {})
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
  onPlaying?: () => void
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
        const utterance = new SpeechSynthesisUtterance(text)
        utterance.lang = 'zh-CN'
        const finish = () => {
          signal.removeEventListener('abort', cancel)
          resolve()
        }
        const cancel = () => {
          speechSynthesis.cancel()
          finish()
        }
        current!.cancel = cancel
        utterance.onstart = () => onPlaying?.()
        utterance.onend = finish
        utterance.onerror = () => {
          signal.removeEventListener('abort', cancel)
          signal.aborted ? resolve() : reject(Error('系统朗读失败，可在语音设置选择 DeepSeek TTS'))
        }
        signal.addEventListener('abort', cancel, { once: true })
        speechSynthesis.speak(utterance)
      })
    } else {
      prepareSpeech()
      const audio = context!
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
        const buffer = await audio.decodeAudioData(await response.arrayBuffer())
        if (signal.aborted) break
        if (audio.state === 'suspended') await audio.resume()
        if (audio.state !== 'running') throw Error('浏览器暂停了音频，请点一下朗读或重新拨打')
        await new Promise<void>((resolve) => {
          const source = audio.createBufferSource()
          source.buffer = buffer
          source.connect(audio.destination)
          let finished = false
          const finish = () => {
            if (finished) return
            finished = true
            source.disconnect()
            signal.removeEventListener('abort', cancel)
            resolve()
          }
          const cancel = () => {
            try {
              source.stop()
            } catch {}
            finish()
          }
          current!.cancel = cancel
          source.onended = finish
          signal.addEventListener('abort', cancel, { once: true })
          source.start()
          onPlaying?.()
        })
      }
    }
    if (signal.aborted) throw new DOMException('已停止', 'AbortError')
  } finally {
    outer?.removeEventListener('abort', abort)
    if (current?.controller === controller) current = undefined
  }
}
export function releaseSpeech() {
  stopSpeech()
  void context?.close().catch(() => {})
  context = undefined
}
