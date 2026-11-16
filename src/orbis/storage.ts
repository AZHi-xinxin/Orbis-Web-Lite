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
export const saveSecret = (key: string, value: string) => {
  if (value) sessionStorage.setItem('orbis-secret:' + key, value)
  else sessionStorage.removeItem('orbis-secret:' + key)
}
export const secret = (key: string) => sessionStorage.getItem('orbis-secret:' + key) ?? ''
