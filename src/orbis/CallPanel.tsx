import { useEffect, useState } from 'react'
import { type Message, type VoiceSession } from './core.js'
import { callDuration } from './callArchive.js'
import { assetUrl } from './assets.js'
import { Markdown } from '../components/markdown/Markdown.js'

function CallIcon({ kind }: { kind: 'phone' | 'mic' | 'speaker' }) {
  return <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'phone' ? <path d="M3 15v-3c5-5 13-5 18 0v3l-5-1v-3M8 11v3l-5 1" /> : kind === 'mic' ? <><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M9 22h6" /></> : <><path d="M3 9h4l5-5v16l-5-5H3zM16 8a6 6 0 0 1 0 8M19 4a11 11 0 0 1 0 16" /></>}
  </svg>
}

type PanelProps = {
  name: string; deepseek: boolean; startedAt: number; minimized: boolean; phase: string; caption: string
  recording: boolean; micMuted: boolean; speakerMuted: boolean
  onMinimize: () => void; onExpand: () => void; onMic: () => void; onSpeaker: () => void
  onResumeAudio?: () => void
  onHangup: () => void; onFinish: () => void; onInterrupt: () => void
}
export function CallPanel(p: PanelProps) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const duration = callDuration({ id: '', startedAt: p.startedAt, status: 'active', summaryStatus: 'pending' }, now)
  if (p.minimized) return <div className="call-mini">
    <button onClick={p.onExpand} aria-label="返回通话界面"><span className="call-live-dot" /> {p.name} · {duration} · {p.phase}</button>
    <button className="call-mini-hangup" onClick={p.onHangup}>挂断</button>
  </div>
  return <section className="voice-call-screen" role="dialog" aria-modal="true" aria-label="语音通话">
    <header><span>ORBIS · 语音通话</span><button onClick={p.onMinimize}>收起</button></header>
    <div className="call-person">
      <div className={'call-avatar' + (p.phase === '正在说' ? ' is-speaking' : '')}>
        {p.deepseek ? <img src={assetUrl('deepseek.svg')} alt="" /> : <span>{p.name.slice(0, 1) || '✦'}</span>}
      </div>
      <h1>{p.name}</h1><time>{duration}</time>
      <p role="status" className="call-phase"><span className="call-live-dot" />{p.phase}</p>
    </div>
    <div className="call-caption" aria-label="当前通话字幕">{p.caption}</div>
    <div className="call-turn-action">
      {p.onResumeAudio ? <button onClick={p.onResumeAudio}>开启声音并播放</button> : p.recording ? <button onClick={p.onFinish}>说完了，发送本句</button> : p.phase === '正在说' ? <button onClick={p.onInterrupt}>打断本条播报</button> : <span>停顿后自动发送，也可以手动结束本句</span>}
    </div>
    <div className="call-controls">
      <div><button className={p.micMuted ? 'is-muted' : ''} onClick={p.onMic} aria-pressed={p.micMuted} aria-label={p.micMuted ? '打开麦克风' : '关闭麦克风'}><CallIcon kind="mic" /></button><span>{p.micMuted ? '麦克风已关' : '关闭麦克风'}</span></div>
      <div><button className="hangup" onClick={p.onHangup} aria-label="挂断通话"><CallIcon kind="phone" /></button><span>挂断</span></div>
      <div><button className={p.speakerMuted ? 'is-muted' : ''} onClick={p.onSpeaker} aria-pressed={p.speakerMuted} aria-label={p.speakerMuted ? '打开声音' : '关闭声音'}><CallIcon kind="speaker" /></button><span>{p.speakerMuted ? '声音已关' : '关闭声音'}</span></div>
    </div>
    <footer>挂断后自动整理总结，完整记录保留。<br />通话时请保持网页在前台；锁屏或切后台可能中断。</footer>
  </section>
}

export function CallHistoryCard({ call, messages, name, live, busy, onRetry, onReturn }: {
  call: VoiceSession; messages: Message[]; name: string; live: boolean; busy: boolean; onRetry: () => void; onReturn: () => void
}) {
  const [open, setOpen] = useState(false)
  const records = call.raw ?? messages.filter((m) => m.voiceSessionId === call.id)
  const labels = { pending: '原文保留 · 等待整理', working: 'AI 正在总结 · 原文保留', done: '已归档 · 原文保留', failed: '总结未完成 · 原文保留', empty: '本次没有已发送的通话内容' }
  return <div className="voice-call-card">
    <div className="voice-call-card-title"><CallIcon kind="phone" /><strong>{live ? '通话中' : call.status === 'active' ? '通话未正常结束' : '通话结束'}</strong>{call.endedAt && <time>{callDuration(call)}</time>}</div>
    <p>{call.status === 'active' && !live ? '原记录已保存，没有自动重拨或重放。' : labels[call.summaryStatus]}</p>
    {live && <button onClick={onReturn}>返回通话</button>}
    <button onClick={() => setOpen(true)}>查看完整记录 ›</button>
    {call.summaryStatus === 'done' && <details className="call-summary"><summary>通话总结</summary><Markdown content={call.summary ?? ''} loading={false} cacheKey={call.id + (call.attempt ?? '')} disableLink={false} /></details>}
    {call.summaryStatus === 'failed' && <p className="call-summary-error">{call.summaryError}</p>}
    {!live && !['done', 'empty'].includes(call.summaryStatus) && <button disabled={busy} onClick={onRetry}>{call.status === 'active' ? '结束并整理记录' : call.summaryStatus === 'failed' ? '重新总结' : '整理通话记录'}</button>}
    {open && <div className="call-history-overlay" role="dialog" aria-modal="true" aria-label="完整通话记录">
      <section><header><div><strong>与 {name} 的通话</strong><small>{new Date(call.startedAt).toLocaleString()}{call.endedAt ? ' · '+callDuration(call) : ''}</small></div><button onClick={() => setOpen(false)} aria-label="关闭通话记录">×</button></header>
        <div className="call-history-scroll">
          {call.summary && <section className="call-history-summary"><h3>通话总结</h3><Markdown content={call.summary} loading={false} cacheKey={call.id + (call.attempt ?? '') + 'history'} disableLink={false} /></section>}
          <h3>原始消息与工具</h3>
          {!records.length && <p>本次没有已发送的内容。</p>}
          {records.map((m) => <article key={m.id} className={'call-original '+m.role}>
            <small>{m.role === 'user' ? '我' : m.role === 'tool' ? '工具结果' : name} · {new Date(m.at).toLocaleTimeString()}</small>
            {m.retracted ? <p>消息已撤回</p> : <>
              {m.role === 'tool' ? <details><summary>查看工具结果</summary><pre>{m.text}</pre></details> : <Markdown content={m.text} loading={false} cacheKey={m.id + 'call-original'} disableLink={false} />}
              {m.calls?.length ? <details><summary>原始工具请求</summary><pre>{JSON.stringify(m.calls,null,2)}</pre></details> : null}
              {m.reasoning && <details><summary>思考过程</summary><p>{m.reasoning}</p></details>}
              {m.files?.map((f) => f.mime.startsWith('audio/') ? <audio key={f.id} controls src={f.data} /> : null)}
            </>}
          </article>)}
        </div>
      </section>
    </div>}
  </div>
}
