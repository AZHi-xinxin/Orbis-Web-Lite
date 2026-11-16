import type { ReactNode } from 'react'
import type { Message } from './core.js'
import { localTimestamp } from './clock.js'

/** Presentation only: the stored event and model request are never rewritten on expand. */
export function SentinelTimeline({ message, children }: { message: Message; children?: ReactNode }) {
  const timestamp = localTimestamp(message.at, message.timeZone || 'UTC')
  const shortTime = timestamp === '时间未知' ? timestamp : timestamp.slice(11, 16)
  return <details className="sentinel-timeline">
    <summary aria-label={`哨兵唤醒 ${shortTime}，展开或收起详情`}>
      <span className="sentinel-time-line" aria-hidden="true" />
      <time dateTime={timestamp === '时间未知' ? undefined : timestamp}>{shortTime}</time>
      <span className="sentinel-chevron" aria-hidden="true">⌄</span>
      <span className="sentinel-time-line" aria-hidden="true" />
    </summary>
    <div className="sentinel-event-content">
      <div className="sentinel-event-title">本地自主哨兵</div>
      <div className="sentinel-event-time">触发时间 · {timestamp.replace('T', ' ')}</div>
      <p>{message.retracted ? '此唤醒记录已撤回' : message.text}</p>
      {children}
    </div>
  </details>
}
