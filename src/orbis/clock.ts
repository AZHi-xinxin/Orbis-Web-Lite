import type { Message } from './core.js'

export type HostClock = { at: number; timeZone: string }
export function captureClock(at = Date.now(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): HostClock {
  if (!Number.isFinite(at) || Math.abs(at) > 8.64e15) { at = Date.now() }
  try { new Intl.DateTimeFormat('en', { timeZone }).format(at) }
  catch { timeZone = 'UTC' }
  return { at: Number.isFinite(at) ? at : Date.now(), timeZone }
}
export function localTimestamp(at: number, timeZone: string): string {
  if (!Number.isFinite(at) || Math.abs(at) > 8.64e15) { return '时间未知' }
  const clock = captureClock(at, timeZone)
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: clock.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset',
  }).formatToParts(at).map((p) => [p.type, p.value]))
  const offset = ['GMT', 'GMT+00:00', 'UTC'].includes(parts.timeZoneName) ? 'Z' : parts.timeZoneName.replace('GMT', '')
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`
}
export function clockReading(clock = captureClock()) {
  clock = captureClock(clock.at, clock.timeZone)
  return { source: 'device_clock', unix_ms: clock.at, time_zone: clock.timeZone,
    local_time: localTimestamp(clock.at, clock.timeZone), utc: new Date(clock.at).toISOString() }
}
/** Stable per-message provenance: never use the current clock or device zone here. */
export function messageTimestamp(m: Message): string {
  return '[宿主消息记录时间，非正文] ' + JSON.stringify({
    at: localTimestamp(m.at, m.timeZone ?? 'UTC'), time_zone: m.timeZone ?? 'UTC',
    unix_ms: m.at, role: m.role, event: m.event === true,
  }) + '\n'
}
