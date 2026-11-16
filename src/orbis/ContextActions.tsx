import { useEffect, useMemo, useRef, useState } from 'react'
import { type State, type Window, windowOf } from './core.js'
import { acquire, clearCompactionDraft, readCompactionDraft, readState, saveCompactionDraft, transact } from './storage.js'
import { applyManualCompaction, assertIdle, compactionCut, compactionText, summaryChunks } from './contextActions.js'
import { compactionFingerprint, defaultSummaryOptions, resumeSummaries, reviewedSegments, summaryDraftText,
  validSummaryDraft, type SummaryDraft, type SummaryOptions } from './manualCompaction.js'

export function ContextActions({ window: w, disabled, onBusy, onState, onNotice, onFork }: {
  window: Window; disabled: boolean; onBusy: (busy: boolean) => void; onState: (s: State) => void
  onNotice: (message: string) => void; onFork: () => void
}) {
  const [originals, setOriginals] = useState(() => structuredClone(w.messages))
  const [keep, setKeep] = useState(0), [size, setSize] = useState(24000)
  const [options, setOptions] = useState<SummaryOptions>(defaultSummaryOptions)
  const [completed, setCompleted] = useState<(string | null)[]>([])
  const [sourceHash, setSourceHash] = useState(''), [loading, setLoading] = useState(true)
  const [stale, setStale] = useState(false)
  const [draft, setDraft] = useState(''), [progress, setProgress] = useState('')
  const [running, setRunning] = useState(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const hash = await compactionFingerprint(originals), saved = await readCompactionDraft(w.id)
        if (!active) return
        setSourceHash(hash)
        if (saved !== undefined) {
          if (!validSummaryDraft(saved) || saved.sourceHash !== hash || saved.keep > originals.length) {
            setStale(true); setProgress('旧压缩草稿对应的聊天已变化，或草稿格式不兼容。请清除旧草稿后重新开始；原聊天保留。'); return
          }
          const total = summaryChunks(compactionText(originals.slice(0, compactionCut(originals, saved.keep))), saved.size).length
          if (saved.completed.length > total) { setStale(true); setProgress('旧草稿的段数不匹配，请清除后重新开始。'); return }
          setKeep(saved.keep); setSize(saved.size); setOptions(saved.options); setCompleted(saved.completed)
          if (saved.completed.length === total && saved.completed.every(s => s !== null)) setDraft(saved.reviewText ?? summaryDraftText(saved.completed, saved.options.mode))
          setProgress(`已恢复 ${saved.completed.filter(s => s !== null).length} / ${total} 段草稿；尚未应用到聊天。`)
        }
      } catch (e) { setStale(true); onNotice(e instanceof Error ? e.message : String(e)) }
      finally { if (active) setLoading(false) }
    })()
    return () => { active = false; controller.current?.abort() }
  }, [w.id])
  const cut = compactionCut(originals, keep)
  const text = useMemo(() => compactionText(originals.slice(0, cut)), [originals, cut])
  const chunks = useMemo(() => summaryChunks(text, size), [text, size])
  const changed = JSON.stringify(w.messages) !== JSON.stringify(originals)
  const blocked = disabled || running || loading
  const done = completed.filter(s => s !== null).length
  const partial = done > 0 && done < chunks.length
  const finished = done > 0 && done === chunks.length
  const draftLimit = finished && options.mode === 'segments' ? 1048576 : 65536
  const frozen = blocked || done > 0 || !!draft || stale
  const checkpoint = (results: (string | null)[], reviewText?: string): SummaryDraft =>
    ({ version: 1, sourceHash, keep, size, options, completed: results,
      ...(reviewText !== undefined && reviewText.length <= 1048576 ? { reviewText } : {}) })
  async function generate() {
    if (blocked || stale || !cut || changed || finished) return
    const c = new AbortController(); controller.current = c
    setRunning(true); onBusy(true)
    let release: (() => Promise<void>) | undefined
    try {
      release = await acquire(w.id)
      const s = await readState(), current = windowOf(s, w.id)
      assertIdle(current)
      if (JSON.stringify(current.messages) !== JSON.stringify(originals)) throw Error('聊天已变化，请重新打开压缩面板')
      await saveCompactionDraft(w.id, checkpoint(completed))
      const results = await resumeSummaries(s, current, chunks, completed, options, c.signal, async next => {
        const review = next.every(s => s !== null) ? summaryDraftText(next, options.mode) : undefined
        await saveCompactionDraft(w.id, checkpoint(next, review))
        setCompleted(next)
      }, (done, total) => setProgress(`整理进度 ${done} / ${total} 段；已完成部分已保存`))
      setDraft(summaryDraftText(results, options.mode)); setProgress('摘要已生成并保存，请核对后点击“应用摘要并压缩”。')
    } catch (e) {
      const message = c.signal.aborted ? '已暂停生成，已完成段落保留；原聊天未改变。可稍后继续。' : e instanceof Error ? e.message : String(e)
      setProgress(message); onNotice(message)
    } finally {
      try { await release?.() } finally {
        if (controller.current === c) controller.current = null
        setRunning(false); onBusy(false)
      }
    }
  }
  async function reset() {
    if (blocked) return
    setRunning(true)
    try {
      await clearCompactionDraft(w.id)
      setCompleted([]); setDraft(''); setStale(false); setProgress('旧草稿已清除，原聊天与记忆没有改变。')
    } catch (e) { onNotice(e instanceof Error ? e.message : String(e)) }
    finally { setRunning(false) }
  }
  async function saveReview() {
    if (blocked || !finished || changed) return
    setRunning(true)
    try { await saveCompactionDraft(w.id, checkpoint(completed, draft)); setProgress('核对后的草稿已保存，尚未应用压缩。') }
    catch (e) { onNotice(e instanceof Error ? e.message : String(e)) }
    finally { setRunning(false) }
  }
  async function apply() {
    if (blocked || stale || partial || !draft.trim() || !cut || changed || draft.length > draftLimit) return
    setRunning(true); onBusy(true)
    let release: (() => Promise<void>) | undefined
    try {
      const segments = finished && options.mode === 'segments' ? reviewedSegments(draft, done) : undefined
      release = await acquire(w.id)
      const result = await transact(s => applyManualCompaction(s, w.id, originals, draft, keep, segments))
      const messages = structuredClone(windowOf(result.state, w.id).messages)
      onState(result.state); setOriginals(messages); setSourceHash(await compactionFingerprint(messages))
      setKeep(0); setCompleted([]); setDraft(''); setProgress('压缩已保存；可以关闭面板继续聊天。')
      try { await clearCompactionDraft(w.id) } catch { onNotice('压缩已应用；草稿清理失败，旧草稿下次会按来源校验隔离。') }
      onNotice(`压缩完成，${segments ? segments.length : 1} 条摘要已存入记忆库，完整原文只保留一个备份窗口。`)
    } catch (e) { onNotice(e instanceof Error ? e.message : String(e)) }
    finally { try { await release?.() } finally { setRunning(false); onBusy(false) } }
  }
  return <div className="context-actions">
    <h3>聊天分支</h3>
    <button disabled={blocked || !w.messages.length} onClick={onFork}>从当前进度开启分支</button>
    <p className="subtle">另存一个窗口继续聊天，原窗口保留。也可在消息的“更多操作”中开启分支。分支本身不会缩短上下文。</p>
    <h3>手动压缩</h3>
    <p>已超出模型上限也可分段整理。生成时逐段保存草稿，核对应用后才修改聊天和记忆。</p>
    <label>保留最近消息数量
      <input type="number" min="0" max={originals.length} value={keep} disabled={frozen}
        onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 0 && n <= originals.length) setKeep(n) }} />
    </label>
    <p className="subtle">将整理前 {cut} 条，保留后 {originals.length - cut} 条；按完整轮次保留工具链。0 表示只带摘要继续。</p>
    <label>摘要方式<select value={options.mode} disabled={frozen} onChange={e => setOptions({ ...options, mode: e.target.value as SummaryOptions['mode'] })}>
      <option value="segments">保留各段摘要，并逐条存入记忆库</option><option value="rolling">逐段合并为一份摘要</option>
    </select></label>
    <label>压缩提示词（视角、风格与重点）
      <textarea rows={3} maxLength={8000} value={options.instructions} disabled={frozen}
        placeholder="例如：以阿止的第一人称总结，保留重要约定、称呼和未完成的事。"
        onChange={e => setOptions({ ...options, instructions: e.target.value })} />
    </label>
    <label>每段资料大小
      <select value={size} disabled={frozen} onChange={e => setSize(Number(e.target.value))}>
        <option value={2000}>小 · 2,000 字符</option><option value={8000}>较小 · 8,000 字符</option>
        <option value={24000}>标准 · 24,000 字符</option><option value={48000}>大 · 48,000 字符</option>
      </select>
    </label>
    <label>同时请求段数<select value={options.mode === 'rolling' ? 1 : options.concurrency}
      disabled={blocked || options.mode === 'rolling' || finished || stale}
      onChange={e => setOptions({ ...options, concurrency: Number(e.target.value) })}>
      <option value={1}>1 · 顺序</option><option value={2}>2 · 并发</option><option value={3}>3 · 并发</option><option value={4}>4 · 并发</option>
    </select></label>
    <label>单段输出上限<select value={options.maxTokens} disabled={blocked || finished || stale}
      onChange={e => setOptions({ ...options, maxTokens: Number(e.target.value) })}>
      <option value={4096}>4,096 token</option><option value={8192}>8,192 token</option><option value={16384}>16,384 token</option>
    </select></label>
    <p className="subtle">共 {chunks.length} 段，已完成 {done} 段，剩余约 {Math.max(0, chunks.length - done)} 次请求，使用当前模型并按服务计费。并发可缩短等待，但服务可能限流；失败不会自动重试，继续只请求未完成的段。暂停时仍在途的请求可能已经计费。输出截断时可提高上限再继续，服务需支持所选上限。</p>
    <p className="subtle">{options.mode === 'segments' ? '每段独立总结；应用后所有段落按顺序一起进入聊天上下文，也分别存入记忆库。' : '每轮把下一段合入累计摘要，最终只应用并保存一份。'}无论多少段，只保留一个完整原文窗口。仅整理文字、工具记录和文本附件，图片/音频只记文件名，思考过程不纳入摘要。</p>
    {changed && <p role="alert">聊天已变化，请重新打开面板；旧草稿不会覆盖新消息。</p>}
    {running ? <button onClick={() => controller.current?.abort()} disabled={!controller.current}>暂停生成</button> :
      <button disabled={blocked || stale || !cut || changed || finished || !!draft} onClick={() => void generate()}>{partial ? '继续未完成的摘要' : 'AI 分段生成摘要'}</button>}
    <p role="status">{progress}</p>
    {(done > 0 || stale || !!draft) && <button disabled={blocked} onClick={() => void reset()}>清除草稿并重新开始</button>}
    {partial && <details><summary>查看已保存的 {done} 段</summary><pre className="summary-preview">{summaryDraftText(completed, options.mode)}</pre></details>}
    <label>压缩摘要（可自行填写或修改）
      <textarea rows={8} maxLength={draftLimit} value={draft} disabled={blocked || partial || stale} onChange={e => setDraft(e.target.value)} />
    </label>
    <p className="subtle">{draft.length.toLocaleString()} / {draftLimit.toLocaleString()} 字符。摘要仍可能超过模型上下文，请核对容量；不保证保留所有细节。分段模式请保留“【历史摘要 N】”标题，修改会同步存入各条记忆。生成进度自动保存；修改文字后请点保存草稿。浏览器暂停或关闭时可稍后继续，清除网站数据会丢失本地资料。</p>
    {finished && <button disabled={blocked || changed || draft.length > draftLimit} onClick={() => void saveReview()}>保存核对后的草稿</button>}
    <button className="primary" disabled={blocked || stale || partial || !draft.trim() || draft.length > draftLimit || !cut || changed}
      onClick={() => void apply()}>应用摘要并压缩</button>
  </div>
}
