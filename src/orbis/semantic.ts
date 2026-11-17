import { semanticSources, windowOf, type State, type Selection } from './core.js'
import { slices } from './wordpiece.js'
let worker: Worker | undefined
let bootTimer: ReturnType<typeof setTimeout> | undefined
const recallBudget = 1500
function reset(target: Worker) {
  target.terminate()
  if (worker === target) {
    worker = undefined
    clearTimeout(bootTimer)
  }
}
function getWorker() {
  if (worker) return worker
  const target = new Worker(new URL('./semantic.worker.ts', import.meta.url), { type: 'module' })
  worker = target
  // A cold model may finish loading after the chat has continued. Keep it for the
  // next turn, but never leave a broken download/initialization running forever.
  bootTimer = setTimeout(() => reset(target), 60000)
  target.addEventListener('message', (event) => {
    if (event.data.ready && worker === target) clearTimeout(bootTimer)
  })
  target.addEventListener('error', () => reset(target))
  target.addEventListener('messageerror', () => reset(target))
  return target
}
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
  const chunks: ReturnType<typeof semanticSources> = []
  for (const n of semanticSources(s)) {
    for (const text of slices(n.text)) {
      chunks.push({ ...n, text })
      if (chunks.length === 64) break
    }
    if (chunks.length === 64) break
  }
  if (!chunks.length) return Promise.resolve({ selection: [] })
  let target: Worker
  try { target = getWorker() }
  catch { return Promise.resolve({ selection: [], error: '浏览器无法启动本地语义检索' }) }
  const id = crypto.randomUUID()
  return new Promise((resolve) => {
    let finished = false
    const cleanup = () => {
      clearTimeout(timer)
      target.removeEventListener('message', message)
      target.removeEventListener('error', error)
      target.removeEventListener('messageerror', error)
      signal.removeEventListener('abort', abort)
    }
    const finish = (result: { selection: Selection[]; error?: string }) => {
      if (finished) return
      finished = true
      cleanup()
      resolve(result)
    }
    const abort = () => {
      reset(target)
      finish({ selection: [] })
    }
    const error = () => {
      reset(target)
      finish({ selection: [], error: '本地语义检索暂不可用' })
    }
    const message = (event: MessageEvent) => {
      if (event.data.id === id) {
        if (event.data.error) reset(target)
        finish({ ...event.data, selection: event.data.selection ?? [] })
      }
    }
    const timer = setTimeout(() => {
      // Cancel this query, not the model download. Late results never enter the
      // frozen request; a later turn can use the warm model and cached vectors.
      try { target.postMessage({ cancel: id }) } catch { reset(target) }
      finish({ selection: [] })
    }, recallBudget)
    target.addEventListener('message', message)
    target.addEventListener('error', error)
    target.addEventListener('messageerror', error)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) {
      abort()
      return
    }
    try { target.postMessage({ id, query: query.slice(0, 700), chunks, deadline: Date.now() + recallBudget }) }
    catch { error() }
  })
}
