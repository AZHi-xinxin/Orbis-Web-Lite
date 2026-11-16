// Reuse the element unlocked by the user's tap, including across microphone turns.
let player: HTMLAudioElement | undefined
let active = false
export type PlaybackGate = (resume: (() => void) | undefined) => void
const silence = 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQIAAAAAAA=='
function audioPlayer() {
  if (!player) {
    player = new Audio()
    player.preload = 'auto'
    player.setAttribute('playsinline', '')
  }
  return player
}
/** Invoke synchronously in a click handler, before any await. */
export function preparePlayback() {
  const audio = audioPlayer()
  if (active) { return }
  audio.src = silence
  void audio.play().catch(() => {})
}
export function playSpeechBlob(blob: Blob, signal: AbortSignal, onPlaying?: () => void, gate?: PlaybackGate) {
  if (signal.aborted) { return Promise.reject(new DOMException('已停止', 'AbortError')) }
  const audio = audioPlayer(), url = URL.createObjectURL(blob)
  active = true
  audio.src = url
  return new Promise<void>((resolve, reject) => {
    let finished = false
    const finish = (error?: unknown) => {
      if (finished) { return }
      finished = true
      audio.pause()
      audio.removeEventListener('ended', ended)
      audio.removeEventListener('error', failed)
      signal.removeEventListener('abort', aborted)
      audio.removeAttribute('src')
      audio.load()
      URL.revokeObjectURL(url)
      active = false
      gate?.(undefined)
      error ? reject(error) : resolve()
    }
    const ended = () => finish()
    const failed = () => finish(Error('无法播放这段语音，请检查浏览器的音频支持'))
    const aborted = () => finish(new DOMException('已停止', 'AbortError'))
    const resume = () => {
      if (finished || signal.aborted) { return }
      // This must remain before any await: Safari checks this element's user activation.
      const pending = audio.play()
      void pending.then(() => {
        if (!finished) { gate?.(undefined); onPlaying?.() }
      }, (error: unknown) => {
        if (finished) { return }
        if (error instanceof DOMException && error.name === 'NotAllowedError' && gate) { gate(resume) }
        else { finish(error) }
      })
    }
    audio.addEventListener('ended', ended)
    audio.addEventListener('error', failed)
    signal.addEventListener('abort', aborted, { once: true })
    resume()
  })
}
export function releasePlayback() {
  player?.pause()
  player?.removeAttribute('src')
  player?.load()
  player = undefined
}
