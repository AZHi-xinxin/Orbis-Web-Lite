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
  // Assistant messages are examples of how to reply. Putting host metadata in
  // those bodies teaches the model to emit it, especially after compaction.
  if (m.role !== 'user') return ''
  if (m.sourceTimeUnknown) { return '[导入记录：原消息时间未知]\n' }
  return '[宿主消息记录时间，非正文] ' + JSON.stringify({
    at: localTimestamp(m.at, m.timeZone ?? 'UTC'), time_zone: m.timeZone ?? 'UTC',
    unix_ms: m.at, role: m.role, event: m.event === true,
  }) + '\n'
}

/** Request/display projection only. Stored history and exports remain untouched. */
export function assistantBody(text: string, streaming = false): string {
  const marker = '[宿主消息记录时间，非正文]'
  let rest = text
  for (;;) {
    const head = rest.trimStart()
    if (streaming && head && marker.startsWith(head)) return ''
    if (!head.startsWith(marker)) return rest
    const json = head.slice(marker.length).trimStart()
    if (!json.startsWith('{')) return streaming && !json ? '' : rest
    // The host envelope has only scalar fields. Do not remove arbitrary JSON,
    // dates, quoted examples, code blocks or markers in the middle of prose.
    const end = json.indexOf('}')
    if (end < 0) return streaming && json.length < 1000 ? '' : rest
    try {
      const value = JSON.parse(json.slice(0, end + 1))
      if (Object.keys(value).sort().join(',') !== 'at,event,role,time_zone,unix_ms' ||
          value.role !== 'assistant' || typeof value.event !== 'boolean' ||
          typeof value.at !== 'string' || typeof value.time_zone !== 'string' ||
          typeof value.unix_ms !== 'number' || !Number.isFinite(value.unix_ms)) return rest
    } catch { return rest }
    rest = json.slice(end + 1).trimStart()
  }
}
