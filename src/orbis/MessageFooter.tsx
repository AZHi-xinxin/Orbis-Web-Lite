import type { Message } from './core.js'

function Icon({ kind }: { kind: 'copy' | 'quote' | 'speaker' | 'more' }) {
  return <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'copy' && <><rect x="8" y="8" width="12" height="13" rx="3"/><path d="M15 8V6a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v7a3 3 0 0 0 3 3h2"/></>}
    {kind === 'quote' && <><path d="M10 7H5v6h5V7Zm9 0h-5v6h5V7ZM10 13c0 3-2 5-5 5m14-5c0 3-2 5-5 5"/></>}
    {kind === 'speaker' && <><path d="m11 4-6 5H2v6h3l6 5V4Zm5 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></>}
    {kind === 'more' && <><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></>}
  </svg>
}

export function MessageActions({ message: m, disabled, copy, quote, speak, revoke, branch }: {
  message: Message; disabled: boolean; copy: () => void; quote: () => void; speak: () => void; revoke: () => void; branch: () => void
}) {
  return <div className="message-actions" aria-label="消息操作">
    <button title="复制" aria-label="复制" onClick={copy} disabled={!m.text}><Icon kind="copy"/></button>
    {m.role === 'assistant' && m.text && <button title="朗读" aria-label="朗读" onClick={speak}><Icon kind="speaker"/></button>}
    <details className="message-more">
      <summary title="更多操作" aria-label="更多操作"><Icon kind="more"/></summary>
      <div className="message-menu">
        <button disabled={disabled} onClick={e => { branch(); e.currentTarget.closest('details')?.removeAttribute('open') }}>从此轮开启分支</button>
        <button onClick={e => { quote(); e.currentTarget.closest('details')?.removeAttribute('open') }}><Icon kind="quote"/>引用</button>
        {m.role === 'user' && !m.event && <button disabled={disabled} onClick={e => { revoke(); e.currentTarget.closest('details')?.removeAttribute('open') }}>撤回</button>}
      </div>
    </details>
    <small>{m.status === 'stopped' ? '已停止' : m.status === 'error' ? '请求未完成' : ''}</small>
  </div>
}

const number = (n?: number) => n === undefined ? '未提供' : n.toLocaleString() + ' token'
export function UsageRecord({ message: m }: { message: Message }) {
  const u = m.usage
  const percent = u?.input && u.cached !== undefined ? (100 * u.cached / u.input).toFixed(1) + '%' : undefined
  return <details className="usage-record">
    <summary><span>用量记录{m.elapsedMs !== undefined ? ` · 用时 ${(m.elapsedMs / 1000).toFixed(1)} 秒` : ''}</span><span className="usage-expand">展开</span><span className="usage-collapse">收起</span></summary>
    <div className="usage-card">
      <dl><div><dt>发送给模型</dt><dd>{number(u?.input)}</dd></div><div><dt>模型生成</dt><dd>{number(u?.output)}</dd></div><div><dt>缓存复用</dt><dd>{number(u?.cached)}{percent ? ` · ${percent}` : ''}</dd></div></dl>
      <p>{u ? '服务商返回的本次请求用量；工具续轮分别记录。' : m.elapsedMs === undefined ? '这条旧消息未记录用量。新回复会显示接口实际返回的数据。' : '接口未返回用量，未用本地估算替代。'}</p>
    </div>
  </details>
}
