import type { Message } from './core.js'

export function importedBody(m: Message): string {
  return (m.importHistory ?? []).reduce((text, item) => text.replace(item.text, ''), m.text).trim()
}
/** Read-only display. These records never populate calls/providerContent. */
export function ImportHistory({ message }: { message: Message }) {
  return <>{message.importHistory?.filter(h => message.text.includes(h.text)).map((h, i) => {
    const sources = [h.record, ...(Array.isArray(h.record.results) ? h.record.results : [])]
      .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object' && !Array.isArray(s))
      .filter(s => typeof s.url === 'string' && /^https?:\/\//i.test(s.url))
    return <details className="tool" key={i}>
      <summary>历史检索 · {String(h.record.type)} · 未重新执行</summary>
      {sources.map((s, j) => <p key={j}><a href={String(s.url)} target="_blank" rel="noopener noreferrer">{String(s.title || s.url)}</a></p>)}
      <pre>{JSON.stringify(h.record, null, 2)}</pre>
    </details>
  })}</>
}
