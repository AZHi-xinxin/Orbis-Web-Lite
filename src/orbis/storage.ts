import { openDB } from 'idb'
import { initialState, type State } from './core.js'
let connection: ReturnType<typeof openDB> | undefined
const db = () =>
  (connection ??= openDB('orbis-web-lite-v1', 1, {
    upgrade(d) {
      d.createObjectStore('state')
      d.createObjectStore('leases')
    },
  }))
export async function readState(): Promise<State> {
  const d = await db()
  return (await d.get('state', 'main')) ?? initialState()
}
// Separate from chat state: unfinished summaries cannot become model context or memories.
// Only an explicit reviewed application changes the conversation.
export async function readCompactionDraft(id: string): Promise<unknown> {
  return (await db()).get('state', 'manual-compaction:' + id)
}
export async function saveCompactionDraft(id: string, value: unknown): Promise<void> {
  await (await db()).put('state', value, 'manual-compaction:' + id)
}
export async function clearCompactionDraft(id: string): Promise<void> {
  await (await db()).delete('state', 'manual-compaction:' + id)
}
/** All logical changes, including original branch + compaction + rollback slot, commit together. */
export async function transact<T>(
  operation: (s: State) => T
): Promise<{ state: State; result: T }> {
  const d = await db(),
    tx = d.transaction('state', 'readwrite')
  try {
    const s: State = (await tx.store.get('main')) ?? initialState()
    const result = operation(s)
    s.revision++
    await tx.store.put(s, 'main')
    await tx.done
    window.dispatchEvent(new Event('orbis-change'))
    return { state: s, result }
  } catch (e) {
    try {
      tx.abort()
    } catch {}
    // A failed put and the transaction's completion promise reject separately.
    // Observe both while preserving the original quota/validation error for the UI.
    await tx.done.catch(() => {})
    throw e
  }
}
const owner = crypto.randomUUID()
export async function acquire(windowId: string): Promise<() => Promise<void>> {
  const d = await db(),
    tx = d.transaction('leases', 'readwrite'),
    key = 'generation',
    old = await tx.store.get(key),
    now = Date.now()
  if (old && old.expires > now) {
    await tx.done
    throw Error('另一个窗口正在回复，请等待或停止后再发')
  }
  await tx.store.put({ owner, window: windowId, expires: now + 45000 }, key)
  await tx.done
  const timer = setInterval(
    () =>
      void (async () => {
        const t = d.transaction('leases', 'readwrite')
        const current = await t.store.get(key)
        if (current?.owner === owner)
          await t.store.put({ ...current, expires: Date.now() + 45000 }, key)
        await t.done
      })().catch(() => {}),
    10000
  )
  return async () => {
    clearInterval(timer)
    const t = d.transaction('leases', 'readwrite')
    const current = await t.store.get(key)
    if (current?.owner === owner) await t.store.delete(key)
    await t.done
  }
}
const prefix = 'orbis-secret:'
export const remembersSecrets = () => {
  try {
    return localStorage.getItem('orbis-remember-secrets') === '1'
  } catch {
    return false
  }
}
export const secret = (key: string) => {
  if (remembersSecrets()) {
    try {
      const value = localStorage.getItem(prefix + key)
      if (value !== null) return value
    } catch {}
  }
  try {
    return sessionStorage.getItem(prefix + key) ?? ''
  } catch {
    return ''
  }
}
export const saveSecret = (key: string, value: string) => {
  // Persist first so a failed write is visible to the caller, never falsely "saved".
  if (remembersSecrets()) {
    if (value) localStorage.setItem(prefix + key, value)
    else localStorage.removeItem(prefix + key)
  }
  if (value) sessionStorage.setItem(prefix + key, value)
  else sessionStorage.removeItem(prefix + key)
}
export function secretSnapshot(): Record<string, string> {
  const keys = new Set(
    [...Object.keys(localStorage), ...Object.keys(sessionStorage)]
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length))
  )
  return Object.fromEntries([...keys].map((k) => [k, secret(k)]).filter(([, v]) => v))
}
export function rememberSecrets(enabled: boolean) {
  const values = secretSnapshot()
  if (enabled) {
    try {
      for (const [k, v] of Object.entries(values)) localStorage.setItem(prefix + k, v)
      localStorage.setItem('orbis-remember-secrets', '1')
    } catch (error) {
      for (const k of Object.keys(localStorage))
        if (k.startsWith(prefix)) localStorage.removeItem(k)
      localStorage.removeItem('orbis-remember-secrets')
      throw error
    }
  } else {
    for (const [k, v] of Object.entries(values)) sessionStorage.setItem(prefix + k, v)
    localStorage.removeItem('orbis-remember-secrets')
    for (const k of Object.keys(localStorage)) if (k.startsWith(prefix)) localStorage.removeItem(k)
  }
}
