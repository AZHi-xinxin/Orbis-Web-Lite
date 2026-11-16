import { semanticSources, windowOf, type State, type Selection } from './core.js'
import { slices } from './wordpiece.js'
let worker: Worker | undefined
export function recall(
  s: State,
  window: string,
  query: string,
  signal: AbortSignal
): Promise<{ selection: Selection[]; error?: string }> {
  if (
    s.settings.semantic === false ||
    !s.settings.autoInject ||
    windowOf(s, window).mode === 'light' ||
    Array.from(query).length < 4
  )
    return Promise.resolve({ selection: [] })
  const chunks = semanticSources(s)
    .flatMap((n) => slices(n.text).map((text) => ({ ...n, text })))
    .slice(0, 64)
  if (!chunks.length) return Promise.resolve({ selection: [] })
  worker ??= new Worker(new URL('./semantic.worker.ts', import.meta.url), { type: 'module' })
  const target = worker,
    id = crypto.randomUUID()
  return new Promise((resolve) => {
    const cleanup = () => {
      clearTimeout(timer)
      target.removeEventListener('message', message)
      target.removeEventListener('error', error)
      signal.removeEventListener('abort', abort)
    }
    const finish = (result: { selection: Selection[]; error?: string }) => {
      cleanup()
      resolve(result)
    }
    const abort = () => {
      target.terminate()
      if (worker === target) worker = undefined
      finish({ selection: [] })
    }
    const error = () => {
      abort()
      windowNotice('本地语义召回暂不可用，本轮仍可使用关键词与记忆查询')
    }
    const message = (event: MessageEvent) => {
      if (event.data.id === id) finish(event.data)
    }
    const timer = setTimeout(() => {
      abort()
      windowNotice('本地语义召回超时，本轮继续聊天；可在记忆库关闭语义召回')
    }, 30000)
    target.addEventListener('message', message)
    target.addEventListener('error', error)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) {
      abort()
      return
    }
    target.postMessage({ id, query: query.slice(0, 700), chunks })
  })
}
export function windowNotice(message: string) {
  globalThis.window?.dispatchEvent(new CustomEvent('orbis-notice', { detail: message }))
}
