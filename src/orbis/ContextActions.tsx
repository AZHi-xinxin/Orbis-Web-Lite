import { useEffect, useMemo, useRef, useState } from 'react'
import { type State, type Window, windowOf } from './core.js'
import { acquire, readState, transact } from './storage.js'
import { applyManualCompaction, assertIdle, compactionCut, compactionText, summaryChunks } from './contextActions.js'
import { summarizeChunks } from './manualCompaction.js'

export function ContextActions({ window: w, disabled, onBusy, onState, onNotice, onFork }: {
  window: Window; disabled: boolean; onBusy: (busy: boolean) => void; onState: (s: State) => void
  onNotice: (message: string) => void; onFork: () => void
}) {
  const [originals, setOriginals] = useState(() => structuredClone(w.messages))
  const [keep, setKeep] = useState(0), [size, setSize] = useState(24000)
  const [draft, setDraft] = useState(''), [progress, setProgress] = useState('')
  const [running, setRunning] = useState(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const cut = compactionCut(originals, keep)
  const text = useMemo(() => compactionText(originals.slice(0, cut)), [originals, cut])
  const chunks = useMemo(() => summaryChunks(text, size), [text, size])
  const changed = JSON.stringify(w.messages) !== JSON.stringify(originals)
  const blocked = disabled || running
  async function generate() {
    if (blocked || !cut || changed) return
    const c = new AbortController(); controller.current = c
    setRunning(true); onBusy(true)
    let release: (() => Promise<void>) | undefined
    try {
      release = await acquire(w.id)
      const s = await readState(), current = windowOf(s, w.id)
      assertIdle(current)
      if (JSON.stringify(current.messages) !== JSON.stringify(originals)) throw Error('聊天已变化，请重新打开压缩面板')
      const summary = await summarizeChunks(s, current, chunks, c.signal,
        (done, total) => setProgress(`整理进度 ${done} / ${total} 段`))
      setDraft(summary); setProgress('摘要已生成，请核对后点击“应用摘要并压缩”。')
    } catch (e) {
      const message = c.signal.aborted ? '已取消生成，未应用压缩；原聊天保留。' : e instanceof Error ? e.message : String(e)
      setProgress(message); onNotice(message)
    } finally {
      await release?.(); if (controller.current === c) controller.current = null
      setRunning(false); onBusy(false)
    }
  }
  async function apply() {
    if (blocked || !draft.trim() || !cut || changed) return
    setRunning(true); onBusy(true)
    let release: (() => Promise<void>) | undefined
    try {
      release = await acquire(w.id)
      const result = await transact(s => applyManualCompaction(s, w.id, originals, draft, keep))
      onState(result.state); setOriginals(structuredClone(windowOf(result.state, w.id).messages))
      setKeep(0); setDraft(''); setProgress('压缩已保存；可以关闭面板继续聊天。')
      onNotice('压缩完成，已保留完整原文窗口。若提示词或保留内容仍超限，可继续缩小或调整模型设置。')
    } catch (e) { onNotice(e instanceof Error ? e.message : String(e)) }
    finally { await release?.(); setRunning(false); onBusy(false) }
  }
  return <div className="context-actions">
    <h3>聊天分支</h3>
    <button disabled={blocked || !w.messages.length} onClick={onFork}>从当前进度开启分支</button>
    <p className="subtle">另存一个窗口继续聊天，原窗口保留。也可在某条消息的“更多操作”中从该轮开启分支。分支本身不会缩短上下文。</p>
    <h3>手动压缩</h3>
    <p>即使当前对话已超出模型上限，也可分段整理历史，或直接填写摘要后应用。</p>
    <label>保留最近消息数量
      <input type="number" min="0" max={originals.length} value={keep} disabled={blocked || !!draft}
        onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 0 && n <= originals.length) setKeep(n) }} />
    </label>
    <p className="subtle">将整理前 {cut} 条，保留后 {originals.length - cut} 条；按完整轮次保留工具链。0 表示只带摘要继续，完整原文仍另存。</p>
    <label>每段资料大小
      <select value={size} disabled={blocked} onChange={e => setSize(Number(e.target.value))}>
        <option value={2000}>小 · 2,000 字符</option><option value={8000}>较小 · 8,000 字符</option>
        <option value={24000}>标准 · 24,000 字符</option><option value={48000}>大 · 48,000 字符</option>
      </select>
    </label>
    <p className="subtle">约 {chunks.length} 次模型请求，按所选服务计费；逐段合并累计摘要。只整理文字、工具记录和文本附件，图片/音频仅记录附件名，思考过程不纳入摘要。超限时可改用更小分段。</p>
    {changed && <p role="alert">聊天已变化，请关闭后重新打开面板；当前摘要不会覆盖新消息。</p>}
    {running ? <button onClick={() => controller.current?.abort()} disabled={!controller.current}>取消生成</button> :
      <button disabled={blocked || !cut || changed} onClick={() => void generate()}>AI 分段生成摘要</button>}
    <p role="status">{progress}</p>
    <label>压缩摘要（可自行填写或修改）
      <textarea rows={8} maxLength={65536} value={draft} disabled={blocked} onChange={e => setDraft(e.target.value)} />
    </label>
    <p className="subtle">应用前请核对重要约定、事实与待办。手动压缩始终保留完整原文窗口，应用失败或取消生成都不改聊天。摘要不保证保留所有细节，可随时查原文。</p>
    <button className="primary" disabled={blocked || !draft.trim() || !cut || changed} onClick={() => void apply()}>应用摘要并压缩</button>
  </div>
}
