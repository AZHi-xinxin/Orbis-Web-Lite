/** Only the currently visible page can offer a call. Nothing is replayed on reload. */
export type Invitation = {
  id: string
  window: string
  turn: string
  reason: string
  deadline: number
}
type Host = {
  available: (window: string) => boolean
  accept: (invitation: Invitation) => void
  end: () => void
}
let host: Host | undefined
let active: { id: string; window: string } | undefined
let pending: { invite: Invitation; finish: (status: string) => void } | undefined
const notify = () => window.dispatchEvent(new Event('orbis-incoming-call'))
export const incomingCall = () => pending?.invite
export const boundCall = (window: string) => (active?.window === window ? active.id : undefined)
export function setActiveCall(window: string, id: string) {
  active = { window, id }
}
export function clearActiveCall() {
  active = undefined
}
export function registerVoiceHost(next: Host) {
  host = next
  return () => {
    if (host === next) {
      pending?.finish('cancelled')
      active = undefined
      host = undefined
    }
  }
}
export function respondIncoming(accept: boolean) {
  const request = pending
  if (!request) {
    return
  }
  if (!accept) {
    request.finish('rejected')
    return
  }
  if (Date.now() >= request.invite.deadline || !host?.available(request.invite.window)) {
    request.finish('no_response')
    return
  }
  try {
    // This callback runs in the user's tap, so iOS audio can be unlocked.
    host.accept(request.invite)
    setActiveCall(request.invite.window, request.invite.id)
    request.finish('accepted')
  } catch {
    request.finish('failed')
  }
}
export function requestIncoming(invite: Invitation, signal: AbortSignal): Promise<string> {
  if (signal.aborted || !host?.available(invite.window) || active || pending || document.hidden) {
    return Promise.resolve('unavailable')
  }
  return new Promise((resolve) => {
    const abort = () => finish('cancelled')
    const finish = (status: string) => {
      if (pending?.invite.id !== invite.id) {
        return
      }
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      pending = undefined
      notify()
      resolve(status)
    }
    const timer = setTimeout(() => finish('no_response'), Math.max(0, invite.deadline - Date.now()))
    pending = { invite, finish }
    signal.addEventListener('abort', abort, { once: true })
    notify()
  })
}
export function endBoundCall(window: string, id: string | undefined) {
  if (!id || !active || active.window !== window || active.id !== id) {
    return { status: 'already_ended', message: '当前轮次没有仍在进行的对应通话' }
  }
  host?.end()
  active = undefined
  return { status: 'ended', call_id: id }
}
