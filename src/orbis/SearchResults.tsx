import type { Message } from './core.js'
import { safeWebURL, webSources } from './webSearch.js'
export function SearchResults({ message }: { message: Message }) {
  const calls = message.web?.calls ?? [],
    sources = webSources(message)
  if (!calls.length && !sources.length) return null
  const working = message.status === 'working' && calls.some((c) => c.status === 'working')
  return (
    <details className="web-results" open={working || undefined}>
      <summary>
        <span aria-hidden="true">◎</span>{' '}
        {working
          ? '正在联网搜索…'
          : sources.length
            ? `已参考 ${sources.length} 个来源`
            : '联网搜索记录'}{' '}
        <span className="web-result-count">{working ? '搜索中' : '查看来源'}</span>
      </summary>
      <div className="web-result-body">
        {calls.map((c) => (
          <div className="web-query" key={c.id}>
            <span>{c.action === 'search' ? '搜索' : '阅读'}</span>{' '}
            {c.queries.join(' · ') || c.url || '网页资料'}
            {c.status === 'error' && <small> · {c.error || '未取得结果'}</small>}
          </div>
        ))}
        {sources.map((s, i) => (
          <a
            key={s.url}
            href={safeWebURL(s.url)}
            target="_blank"
            rel="noopener noreferrer"
            className="web-source"
          >
            <span className="source-number">{i + 1}</span>
            <div>
              <strong>{s.title}</strong>
              <small>{s.site || new URL(s.url).hostname}</small>
              {s.snippet && <p>{s.snippet}</p>}
            </div>
            <span aria-hidden="true">↗</span>
          </a>
        ))}
      </div>
    </details>
  )
}
