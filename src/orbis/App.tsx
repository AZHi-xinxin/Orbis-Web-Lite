import { assetUrl } from './assets.js'
import { manual } from './help.js'
import { profileName } from './profile.js'
import { MessageActions, UsageRecord } from './MessageFooter.js'
import {
  defaultConversation,
  defaultGeneration,
  parameterWarnings,
  contextMessages,
  type GenerationOptions,
} from './configuration.js'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Markdown } from '../components/markdown/Markdown.js'
import { startRecording, type Recording } from '../services/speech/recorder.js'
import { transcribe } from '../services/api/speech.js'
import { bubbles } from './bubbles.js'
import {
  claimSentinels,
  initialState,
  newWindow,
  readNotes,
  retract,
  rollback,
  sentinelAction,
  textOf,
  tokens,
  uid,
  windowOf,
  type Attachment,
  type Mcp,
  type Message,
  type Mode,
  type State,
} from './core.js'
import { download, fullBackup, restoreBackup, universalChat } from './backup.js'
import { connectMcp } from './network.js'
import { generate, stopGeneration } from './runtime.js'
import { acquire, readState, saveSecret, secret, transact } from './storage.js'
import './style.css'
const modes: Record<Mode, string> = {
  light: '轻量 · 当前窗口',
  standard: '标准 · 跨窗按需',
  independent: '独立 · 跨窗充分',
}
const styles = { silk: '云绸', glass: '星雾', stars: '星芒', book: '书页' }
type Panel = 'none' | 'memory' | 'context' | 'settings' | 'mcp' | 'sentinel' | 'backup' | 'help' | 'profile'
const bytes = (n: number) =>
  n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.ceil(n / 1024) + ' KB'
const base64 = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
export function App() {
  const [state, commitState] = useState<State>(initialState),
    [ready, setReady] = useState(false),
    [active, setActive] = useState(''),
    [panel, setPanel] = useState<Panel>('none'),
    [drawer, setDrawer] = useState(false)
  const [draft, setDraft] = useState(''),
    [thought, setThought] = useState(''),
    [thoughtOn, setThoughtOn] = useState(false),
    [quote, setQuote] = useState<string | undefined>(),
    [files, setFiles] = useState<Attachment[]>([])
  const [busy, setBusy] = useState(false),
    [partial, setPartial] = useState<Message | null>(null),
    [notice, setNotice] = useState(''),
    [noteQuery, setNoteQuery] = useState(''),
    [recording, setRecording] = useState(false),
    [voiceBusy, setVoiceBusy] = useState(false),
    [call, setCall] = useState(false)
  const recordingRef = useRef<Recording | null>(null),
    callRef = useRef(false),
    listRef = useRef<HTMLDivElement>(null),
    busyRef = useRef(false),
    draftWindow = useRef(''),
    pendingFocus = useRef(false)
  const [key, setKey] = useState(() => secret('api')),
    [mcpName, setMcpName] = useState(''),
    [mcpUrl, setMcpUrl] = useState(''),
    [mcpKey, setMcpKey] = useState('')
  const [rulePrompt, setRulePrompt] = useState(''),
    [ruleAt, setRuleAt] = useState(''),
    [ruleKind, setRuleKind] = useState<'once' | 'interval' | 'daily'>('once'),
    [ruleInterval, setRuleInterval] = useState('60')
  const [windowQuery, setWindowQuery] = useState('')
  const [profileDraft, setProfileDraft] = useState(''),
    [profileVisible, setProfileVisible] = useState(false),
    [profileSaving, setProfileSaving] = useState(false)
  const humanName = profileName(state.settings.userName)
  function openProfile() {
    setProfileDraft(humanName)
    setProfileVisible(state.settings.userNameVisibleToAI === true)
    setPanel('profile')
  }
  async function saveProfile() {
    if (profileSaving) return
    setProfileSaving(true)
    try {
      const r = await transact(s => {
        s.settings.userName = profileName(profileDraft)
        s.settings.userNameVisibleToAI = profileVisible
      })
      setState(r.state)
      setPanel('none')
      setNotice('称呼已保存')
    } catch (e) { fail(e) }
    finally { setProfileSaving(false) }
  }
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  const appearance = state.settings.appearance ?? 'orbis'
  const colorMode = state.settings.colorMode ?? (state.settings.dark ? 'dark' : 'light')
  const dark = colorMode === 'system' ? systemDark : colorMode === 'dark'
  const deepseek = appearance === 'deepseek'
  const [switching, setSwitching] = useState(false)
  const pendingChanges = useRef(0)
  const setState = (next: State) => {
    if (!pendingChanges.current) commitState((old) => (next.revision >= old.revision ? next : old))
  }
  const [help, setHelp] = useState('overview')
  const [importFile, setImportFile] = useState<File | null>(null)
  const w = state.windows.find((w) => w.id === active) ?? state.windows[0],
    used = w
      ? tokens(
          textOf({
            ...w,
            messages: contextMessages(w.messages, state.settings.generation ?? defaultGeneration()),
          })
        )
      : 0,
    threshold = state.settings.threshold,
    percent = threshold ? Math.round((100 * used) / threshold) : null
  const conversation = w?.conversation ?? defaultConversation(),
    options = state.settings.generation ?? defaultGeneration()
  const setOption = (k: keyof GenerationOptions, value: unknown) =>
    void change((s) => {
      s.settings.generation = { ...(s.settings.generation ?? defaultGeneration()), [k]: value }
    })
  const fail = (e: unknown) => setNotice(e instanceof Error ? e.message : String(e))
  const change = async (fn: (s: State) => void) => {
    try {
      const preview = structuredClone(state)
      fn(preview)
      pendingChanges.current++
      commitState(preview)
      try {
        const r = await transact(fn)
        pendingChanges.current--
        setState(r.state)
      } catch (e) {
        pendingChanges.current--
        setState(await readState())
        throw e
      }
    } catch (e) {
      fail(e)
    }
  }
  const refresh = async () => {
    try {
      const latest = await readState()
      setState(latest)
    } catch (e) {
      fail(e)
    }
  }
  useEffect(() => {
    void transact(() => {})
      .then((r) => {
        setState(r.state)
        setActive(r.state.windows[0].id)
        setReady(true)
      })
      .catch(fail)
    const noticeHandler = (e: Event) => setNotice((e as CustomEvent<string>).detail)
    window.addEventListener('orbis-notice', noticeHandler)
    const handler = () => void refresh()
    window.addEventListener('orbis-change', handler)
    const timer = setInterval(handler, 2500)
    return () => {
      window.removeEventListener('orbis-notice', noticeHandler)
      window.removeEventListener('orbis-change', handler)
      clearInterval(timer)
      recordingRef.current?.cancel()
      speechSynthesis?.cancel()
      stopGeneration()
    }
  }, [])
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemDark(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    document.documentElement.dataset.orbisTheme = dark ? 'dark' : 'light'
    document.documentElement.dataset.appearance = appearance
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', deepseek ? (dark ? '#1a1a1a' : '#ffffff') : (dark ? '#171f1c' : '#f5f2ec'))
  }, [dark, appearance])
  useLayoutEffect(() => {
    if (!w) return
    if (draftWindow.current) {
      sessionStorage.setItem(
        'orbis-draft:' + draftWindow.current,
        JSON.stringify({ draft, thought, thoughtOn, quote })
      )
    }
    draftWindow.current = w.id
    try {
      const d = JSON.parse(sessionStorage.getItem('orbis-draft:' + w.id) ?? '{}')
      setDraft(d.draft ?? '')
      setThought(d.thought ?? '')
      setThoughtOn(d.thoughtOn ?? false)
      setQuote(d.quote)
    } catch {
      setDraft('')
      setThought('')
      setQuote(undefined)
    }
    setFiles([])
    setDrawer(false)
  }, [w?.id])
  useEffect(() => {
    if (w)
      sessionStorage.setItem(
        'orbis-draft:' + w.id,
        JSON.stringify({ draft, thought, thoughtOn, quote })
      )
  }, [draft, thought, thoughtOn, quote])
  useEffect(() => {
    if (listRef.current && (pendingFocus.current || partial)) {
      listRef.current.scrollTop = listRef.current.scrollHeight
      pendingFocus.current = false
    }
  }, [state, partial])
  useEffect(() => {
    if (!ready) return
    const timer = setInterval(() => {
      if (busyRef.current) return
      void (async () => {
        const latest = await readState()
        if (
          !secret('api') ||
          !latest.settings.sentinelEnabled ||
          !latest.sentinels.some((r) => r.enabled && r.due <= Date.now())
        )
          return
        const claimed = await transact((s) => claimSentinels(s, Date.now()))
        for (const e of claimed.result) {
          try {
            const done = await send(e.window, e.prompt, [], true)
            await transact((s) => {
              const rule = s.sentinels.find((r) => r.id === e.rule)
              if (rule)
                rule.receipt = done
                  ? 'AI 已完成本次主动回复'
                  : '本次未完成，未自动重试；请查看对应窗口'
            })
          } catch (error) {
            fail(error)
          }
        }
      })().catch(fail)
    }, 5000)
    return () => clearInterval(timer)
  }, [ready])
  async function send(
    windowId: string,
    text: string,
    attachments: Attachment[] = [],
    event = false,
    humanThought?: string,
    quoteId?: string
  ) {
    if (busyRef.current) return
    if (!secret('api')) {
      setPanel('settings')
      setNotice('填写你自己的 API Key 后即可聊天；没有预置公共密钥')
      return
    }
    busyRef.current = true
    setBusy(true)
    pendingFocus.current = true
    setNotice('')
    try {
      return await generate(
        windowId,
        text,
        attachments,
        event,
        setPartial,
        setState,
        humanThought,
        quoteId
      )
    } catch (e) {
      fail(e)
      return false
    } finally {
      setPartial(null)
      setBusy(false)
      busyRef.current = false
      await refresh()
    }
  }
  async function submit() {
    if (!w || (!draft.trim() && !files.length && !(thoughtOn && thought.trim())) || busy) return
    if (!secret('api')) {
      setPanel('settings')
      setNotice('请先填写 API Key，草稿已保留')
      return
    }
    const text = draft,
      attachments = files,
      thinking = thoughtOn && thought.trim() ? thought : undefined,
      q = quote
    setDraft('')
    setFiles([])
    setThought('')
    setQuote(undefined)
    await send(w.id, text, attachments, false, thinking, q)
  }
  async function addWindow() {
    if (switching) return
    setSwitching(true)
    try {
      const r = await transact((s) => {
        const n = newWindow('新的聊天', w?.mode)
        s.windows.push(n)
        return n.id
      })
      setState(r.state)
      setActive(r.result)
    } catch (e) {
      fail(e)
    } finally {
      setSwitching(false)
    }
  }
  async function importAttachments(selected: FileList | null) {
    if (!selected) return
    try {
      const next: Attachment[] = []
      for (const f of Array.from(selected)) {
        if (f.size > 15 * 1048576) throw Error('每份附件上限 15 MB')
        if (f.type.startsWith('image/'))
          next.push({ id: uid(), name: f.name, mime: f.type, data: await base64(f), size: f.size })
        else throw Error('当前实验版先支持图片；文本可粘贴发送')
      }
      setFiles((old) => [...old, ...next])
    } catch (e) {
      fail(e)
    }
  }
  async function beginRecord() {
    try {
      const r = await startRecording(() => void finishRecord())
      recordingRef.current = r
      setRecording(true)
    } catch (e) {
      setCall(false)
      callRef.current = false
      fail(e)
    }
  }
  async function finishRecord() {
    const r = recordingRef.current
    if (!r || !w) return
    recordingRef.current = null
    setRecording(false)
    setVoiceBusy(true)
    try {
      const blob = await r.stop()
      if (!blob) throw Error('没有录到声音')
      const text = await transcribe(secret('api'), blob)
      const f: Attachment = {
        id: uid(),
        name: '语音.wav',
        mime: 'audio/wav',
        data: await base64(blob),
        size: blob.size,
      }
      await send(w.id, text, [f])
      if (callRef.current) {
        const latest = await readState()
        const reply = windowOf(latest, w.id)
          .messages.filter((m) => m.role === 'assistant' && !m.calls?.length && !m.retracted)
          .at(-1)
        if (reply?.text) {
          await speak(reply.text)
          if (callRef.current) await beginRecord()
        }
      }
    } catch (e) {
      fail(e)
      callRef.current = false
      setCall(false)
    } finally {
      setVoiceBusy(false)
    }
  }
  function speak(text: string): Promise<void> {
    return new Promise((resolve) => {
      speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'zh-CN'
      u.onend = () => resolve()
      u.onerror = () => resolve()
      speechSynthesis.speak(u)
    })
  }
  async function toggleCall() {
    if (callRef.current) {
      callRef.current = false
      setCall(false)
      recordingRef.current?.cancel()
      recordingRef.current = null
      setRecording(false)
      speechSynthesis.cancel()
      stopGeneration()
      return
    }
    if (!secret('api')) {
      setPanel('settings')
      return
    }
    callRef.current = true
    setCall(true)
    await beginRecord()
  }
  async function addMcp() {
    const c: Mcp = { id: uid(), name: mcpName || 'MCP', url: mcpUrl, tools: [] }
    try {
      saveSecret('mcp:' + c.id, mcpKey)
      setNotice('正在连接 MCP…')
      const tools = await connectMcp(c, AbortSignal.timeout(20000))
      await change((s) => {
        s.mcp.push({ ...c, tools })
      })
      setMcpUrl('')
      setMcpName('')
      setMcpKey('')
      setNotice(`已读到 ${tools.length} 个工具，默认全部关闭，请勾选需要的`)
    } catch (e) {
      saveSecret('mcp:' + c.id, '')
      fail(e)
    }
  }
  async function addRule() {
    if (!w) return
    try {
      const r = await transact((s) =>
        sentinelAction(s, w.id, {
          action: 'create',
          type: ruleKind,
          prompt: rulePrompt,
          due_at_ms: new Date(ruleAt).getTime(),
          interval_seconds: Number(ruleInterval) * 60,
          daily_at: ruleAt,
        })
      )
      setState(r.state)
      setRulePrompt('')
      setNotice('规则已保存；当前实验版仅网页打开时执行')
    } catch (e) {
      fail(e)
    }
  }
  async function revoke(m: Message) {
    if (!w || busy) return
    try {
      const release = await acquire(w.id)
      try {
        await change((s) => retract(s, w.id, m.id, 'user'))
      } finally {
        await release()
      }
    } catch (e) {
      fail(e)
    }
  }
  async function undo() {
    if (!w || busy) return
    try {
      const release = await acquire(w.id)
      try {
        await change((s) => rollback(s, w.id))
      } finally {
        await release()
      }
    } catch (e) {
      fail(e)
    }
  }
  const shown = w?.messages.map((m) => (partial?.id === m.id ? partial : m)) ?? []
  if (!ready) return <div className="loading">✦ 正在打开你的 Orbis…</div>
  return (
    <div className={'orbis ' + state.settings.style + (deepseek ? ' deepseek' : '')}>
      <aside className={'sidebar ' + (drawer ? 'open' : '')}>
        <div className="brand">
          <span className="orb">{deepseek ? <img src={assetUrl('deepseek.svg')} alt="" /> : '✦'}</span>
          <div>
            Orbis <small>WEB LITE · 实验版</small>
          </div>
          <button className="mobile-only" onClick={() => setDrawer(false)} aria-label="收起窗口">
            ×
          </button>
        </div>
        <button className="user-profile" onClick={openProfile} aria-label="修改我的称呼">
          <span className="profile-avatar" aria-hidden="true">{Array.from(humanName)[0] || '○'}</span>
          <span><strong>{humanName || '设置你的称呼'}</strong><small>欢迎回家 · 修改称呼</small></span>
          <span aria-hidden="true">✎</span>
        </button>
        <button disabled={switching} className="new-window" onClick={() => void addWindow()}>
          ＋ 开一个新窗口
        </button>
        <label className="window-search">
          <span aria-hidden="true">⌕</span><input aria-label="搜索对话" placeholder="搜索对话内容…" value={windowQuery} onChange={e => setWindowQuery(e.target.value)} />
        </label>
        <div className="section-caption">{windowQuery ? '搜索结果' : '最近对话'}</div>
        <nav className="windows">
          {[...state.windows]
            .filter(x => !windowQuery.trim() || (x.title + '\n' + x.messages.filter(m => !m.retracted).map(m => m.text).join('\n')).toLocaleLowerCase().includes(windowQuery.trim().toLocaleLowerCase()))
            .sort((a, b) => b.at - a.at)
            .map((x) => (
              <button
                key={x.id}
                className={x.id === w?.id ? 'selected' : ''}
                onClick={() => {
                  setActive(x.id)
                  pendingFocus.current = true
                }}
              >
                <span>
                  {x.archive ? '▧' : '○'}　{x.title}
                </span>
                <small>
                  {modes[x.mode]}
                  {x.archive ? ' · 原文备份' : ''}
                </small>
              </button>
            ))}
        </nav>
        <div className="side-bottom">
          <button onClick={() => setPanel('help')}>? 说明书与使用教程</button>
          <button onClick={() => setPanel('memory')}>
            ◇ 记忆库 <small>{state.notes.filter((n) => !n.deleted).length}</small>
          </button>
          <button onClick={() => setPanel('sentinel')}>◷ 哨兵与主动消息</button>
          <button onClick={() => setPanel('backup')}>⇅ 导入与导出</button>
          <button onClick={() => setPanel('settings')}>⚙ 连接与外观</button>
        </div>
      </aside>
      {drawer && (
        <button className="scrim" aria-label="关闭窗口列表" onClick={() => setDrawer(false)} />
      )}
      <main>
        <header>
          <button className="mobile-only" onClick={() => setDrawer(true)} aria-label="打开窗口列表">
            <svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 7h16M4 16h10" /></svg>
          </button>
          <div className="identity">
            <span className="avatar">{deepseek ? <img src={assetUrl('deepseek.svg')} alt="" /> : '✦'}</span>
            <div>
              <strong>{state.settings.name}</strong>
              <small>{w?.title}</small>
            </div>
          </div>
          <div className="header-actions">
            <button className="header-new" onClick={() => void addWindow()} disabled={switching} aria-label="新建对话"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M20 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-4.7A8.5 8.5 0 1 1 20 11.5Z"/><path d="M8 11.5h8M12 7.5v8"/></svg></button>
            <button
              className="budget"
              onClick={() => setPanel('context')}
              title="上下文与压缩"
              aria-label="上下文与压缩"
            >
              <svg viewBox="0 0 40 40">
                <circle cx="20" cy="20" r="16" />
                <circle
                  cx="20"
                  cy="20"
                  r="16"
                  strokeDasharray={`${Math.min(100, percent ?? 0)} 101`}
                />
              </svg>
              <span>{percent === null ? '·' : percent + '%'}</span>
            </button>
            <button
              className={call ? 'active-call' : ''}
              onClick={() => void toggleCall()}
              aria-label={call ? '挂断语音' : '开始语音通话'}
            >
              {call ? '挂断' : '☎'}
            </button>
            <button onClick={() => setPanel('settings')} aria-label="设置">
              ···
            </button>
          </div>
        </header>
        <div className="mode-bar">
          <select
            aria-label="记忆档位"
            value={w.mode}
            disabled={busy}
            onChange={(e) => {
              const value = e.target.value
              void change((s) => {
                windowOf(s, w.id).mode = value as Mode
              })
            }}
          >
            {Object.entries(modes).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <span>{w.mode === 'light' ? '存查仅限本窗口' : '同一记忆库 · 可随时存查'}</span>
        </div>
        <div className={"messages" + (!shown.length ? " is-empty" : "")} ref={listRef}>
          {!state.settings.tutorialSeen && (
            <div className="first-guide"><button onClick={() => setPanel('help')}>第一次使用？查看连接与记忆指引 ↗</button><button aria-label="收起入门提示" onClick={() => void change(s => { s.settings.tutorialSeen = true })}>×</button></div>
          )}
          {!shown.length && (
            <div className="welcome">
              <div className="welcome-orb">{deepseek ? <img src={assetUrl('deepseek.svg')} alt="DeepSeek" /> : '✦'}</div>
              <h1>{humanName ? `${humanName}，欢迎回家` : '欢迎回家'}</h1>
              {!humanName && <button className="welcome-profile" onClick={openProfile}>告诉 Orbis 怎么称呼你</button>}
              {!deepseek && <div className="suggestions"><button onClick={() => setDraft('请把这件事存进记忆库：')}>记住一件事 ↗</button><button onClick={() => setPanel('memory')}>看看记忆库 ↗</button></div>}
            </div>
          )}
          {shown.map((m) => (
            <article key={m.id} className={'message ' + m.role} id={'msg-' + m.id}>
              {m.role === 'tool' ? (
                <details className="tool">
                  <summary>{m.status === 'working' ? '◌' : '◇'} 工具结果</summary>
                  <pre>{m.text}</pre>
                </details>
              ) : (
                <>
                  <div className="speaker">
                    {m.role === 'user' ? (m.event ? '定时唤醒' : '我') : state.settings.name}
                    <time>
                      {new Date(m.at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </div>
                  {m.retracted ? (
                    <div className="retracted">此消息已撤回</div>
                  ) : (
                    <>
                      {m.quoteId && (
                        <button
                          className="quote"
                          onClick={() =>
                            document
                              .getElementById('msg-' + m.quoteId)
                              ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                          }
                        >
                          ↳{' '}
                          {w.messages.find((x) => x.id === m.quoteId)?.retracted
                            ? '引用内容已撤回'
                            : w.messages.find((x) => x.id === m.quoteId)?.text.slice(0, 150) ||
                              '引用内容不可用'}
                        </button>
                      )}
                      {m.thought?.trim() && (
                        <details className="thought">
                          <summary>人类思考链</summary>
                          <p>{m.thought || '（为空）'}</p>
                        </details>
                      )}
                      {m.reasoning && (
                        <details className="thought">
                          <summary>思考过程</summary>
                          <p>{m.reasoning}</p>
                        </details>
                      )}
                      {bubbles(m.text, state.settings.split && m.role === 'assistant').filter(part => part.trim() || (m.status === 'working' && !m.calls?.length)).map(
                        (part, i) => (
                          <div className="bubble" key={i}>
                            {part ? (
                              <Markdown
                                content={part}
                                loading={m.status === 'working'}
                                cacheKey={m.id + ':' + i}
                                disableLink={false}
                              />
                            ) : m.status === 'working' ? (
                              <span className="typing">正在思考 ···</span>
                            ) : null}
                          </div>
                        )
                      )}
                      {m.files?.map((f) =>
                        f.mime.startsWith('image/') ? (
                          <img className="attachment" key={f.id} src={f.data} alt={f.name} />
                        ) : f.mime.startsWith('audio/') ? (
                          <audio key={f.id} controls src={f.data} />
                        ) : null
                      )}
                      {m.calls?.length ? (
                        <details className="tool">
                          <summary>◇ {m.calls.map((c) => c.name).join('、')}</summary>
                          <pre>{JSON.stringify(m.calls, null, 2)}</pre>
                        </details>
                      ) : null}
                      {(m.text || m.role === 'user') && <MessageActions
                        message={m}
                        disabled={busy}
                        quote={() => {
                            setQuote(m.id)
                            pendingFocus.current = true
                        }}
                        copy={() =>
                            void navigator.clipboard
                              .writeText(m.text)
                              .then(() => setNotice('已复制'))
                              .catch(fail)
                        }
                        revoke={() => void revoke(m)}
                        speak={() => void speak(m.text)}
                      />}
                      {m.role === 'assistant' && m.status !== 'working' && <UsageRecord message={m}/>}
                    </>
                  )}
                </>
              )}
            </article>
          ))}
        </div>
        <div className="composer-area">
          {notice && (
            <div className="notice" role="status">
              <span>{notice}</span>
              <button onClick={() => setNotice('')} aria-label="关闭提示">
                ×
              </button>
            </div>
          )}
          {call && (
            <div className="call-bar">
              ◉ 前台语音通话 ·{' '}
              {recording ? '正在听，点击结束本句后发送' : busy ? '正在回复' : '准备下一句'}
              <button onClick={() => void toggleCall()}>挂断</button>
            </div>
          )}
          <div className="composer">
            {quote && (
              <div className="quote">
                引用：{w.messages.find((m) => m.id === quote)?.text.slice(0, 90)}
                <button onClick={() => setQuote(undefined)}>×</button>
              </div>
            )}
            {thoughtOn && (
              <div className="human-thought-editor">
                <div><span>人类思考链 · 会随正文发给 AI</span><button aria-label="关闭人类思考链" onClick={() => setThoughtOn(false)}>关闭 ×</button></div>
              <textarea
                className="thought-input"
                aria-label="人类思考链"
                placeholder="人类思考链（选填，会和正文一起发给 AI）"
                value={thought}
                onChange={(e) => setThought(e.target.value)}
              />
              </div>
            )}
            {files.length > 0 && (
              <div className="file-chips">
                {files.map((f) => (
                  <span key={f.id}>
                    {f.name} · {bytes(f.size)}
                    <button onClick={() => setFiles((old) => old.filter((x) => x.id !== f.id))}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <textarea
              disabled={switching}
              aria-label="输入消息"
              placeholder={deepseek ? "发消息，或点击语音说话" : "想说的话，慢慢说…"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  window.innerWidth > 700
                ) {
                  e.preventDefault()
                  void submit()
                }
              }}
            />
            <div className="composer-tools">
              {deepseek && <button className={'reasoning-toggle ' + (options.reasoning !== 'off' ? 'enabled' : '')} aria-label="深度思考" aria-pressed={options.reasoning !== 'off'} onClick={() => setOption('reasoning', options.reasoning === 'off' ? 'high' : 'off')} title="切换 AI 深度思考；具体能力取决于所选模型"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><ellipse cx="12" cy="12" rx="4" ry="10" transform="rotate(45 12 12)"/><ellipse cx="12" cy="12" rx="4" ry="10" transform="rotate(-45 12 12)"/><circle cx="12" cy="12" r="1"/></svg>深度思考</button>}
              <label className="attach" title="添加图片" aria-label="添加图片">
                ＋
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => void importAttachments(e.target.files)}
                />
              </label>
              <button
                className={'human-thought ' + (thoughtOn ? 'enabled' : '')}
                onClick={() => setThoughtOn((x) => !x)}
                aria-pressed={thoughtOn}
                aria-label="人类思考链"
                title={thoughtOn ? '点击关闭人类思考链' : '点击开启人类思考链'}
              >
                人类思考 · {thoughtOn ? '开' : '关'}
              </button>
              <button
                className="voice-button"
                disabled={voiceBusy || (busy && !recording)}
                onClick={() => void (recording ? finishRecord() : beginRecord())}
              >
                {recording ? '结束本句' : voiceBusy ? '转写中…' : '♩ 语音'}
              </button>
              <span />
              {busy ? (
                <button
                  className="send"
                  onClick={() => {
                    stopGeneration()
                    setNotice('已请求停止，工具结果未知时不会自动重试')
                  }}
                >
                  停止 ■
                </button>
              ) : (
                <button
                  className="send"
                  onClick={() => void submit()}
                  disabled={!draft.trim() && !files.length && !(thoughtOn && thought.trim())}
                  aria-label="发送消息"
                >
                  ↑
                </button>
              )}
            </div>
          </div>
          <div className="composer-foot">
            Orbis Web Lite · 数据保存在此浏览器 ·{' '}
            <button onClick={() => setPanel('backup')}>导出留存</button> · <a href={assetUrl('source.tar.gz')} download>源码</a>
          </div>
        </div>
      </main>
      {panel !== 'none' && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPanel('none')
          }}
        >
          <section className="panel" role="dialog" aria-modal="true" aria-label={panel}>
            <div className="panel-title">
              <h2>
                {
                  {
                    memory: '记忆库',
                    context: '上下文与压缩',
                    settings: '连接与外观',
                    mcp: 'MCP 工具',
                    sentinel: '哨兵与主动消息',
                    backup: '把记忆带走',
                    help: '说明书与使用教程',
                    profile: '我的称呼',
                  }[panel]
                }
              </h2>
              <button onClick={() => setPanel('none')} aria-label="关闭面板">
                ×
              </button>
            </div>
            {panel === 'profile' && (
              <form className="profile-form" onSubmit={e => { e.preventDefault(); void saveProfile() }}>
                <label>你的称呼<input aria-label="你的称呼" autoFocus maxLength={120} value={profileDraft} onChange={e => setProfileDraft(e.target.value)} placeholder="想让 Orbis 怎么称呼你？" /></label>
                <p className="profile-preview">{profileName(profileDraft) ? `${profileName(profileDraft)}，欢迎回家` : '欢迎回家'}</p>
                <label className="toggle"><input type="checkbox" checked={profileVisible} onChange={e => setProfileVisible(e.target.checked)} />AI 可见</label>
                <p className="hint">开启后，从下一次发消息开始，AI 就能知道你的称呼，所有窗口通用。默认关闭，仅用于页面欢迎语。</p>
                <p className="hint">关闭后不再主动发送称呼，已经发给 AI 的聊天记录不会删除。称呼最多 60 个字，保存在此浏览器。</p>
                <button className="primary" type="submit" disabled={profileSaving}>{profileSaving ? '保存中…' : '保存称呼'}</button>
              </form>
            )}
            {panel === 'help' && (
              <>
                <div className="help-tabs">
                  {Object.entries(manual).map(([id, topic]) => (
                    <button
                      key={id}
                      className={help === id ? 'picked' : ''}
                      onClick={() => setHelp(id)}
                    >
                      {topic.title}
                    </button>
                  ))}
                </div>
                <h3>{manual[help].title}</h3>
                <div className="manual-body">{manual[help].body}</div>
                <button onClick={() => setPanel('settings')}>去连接与设置 →</button>
              </>
            )}
            {panel === 'memory' && (
              <>
                <div className="info">
                  {modes[w.mode]} ·{' '}
                  {w.mode === 'light' ? '仅本窗口可存查' : '所有聊天窗口共用记忆库'}。记忆内容由 AI
                  通过工具维护，你可以在聊天中告诉它要记住或修改什么。
                </div>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={state.settings.autoInject}
                    onChange={(e) => {
                      const checked = e.target.checked
                      void change((s) => {
                        s.settings.autoInject = checked
                      })
                    }}
                  />
                  允许按档位自动带入记忆
                </label>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={state.settings.semantic !== false}
                    onChange={(e) => {
                      const checked = e.target.checked
                      void change((s) => {
                        s.settings.semantic = checked
                      })
                    }}
                  />
                  允许本地语义召回
                </label>
                <input
                  placeholder="查找记忆正文或关键词"
                  aria-label="查找记忆"
                  value={noteQuery}
                  onChange={(e) => setNoteQuery(e.target.value)}
                />
                <div className="info subtle">
                  关键词召回已启用。语义召回从有效压缩摘要中找回相关往事，在本机计算。首次使用会加载约
                  38 MB 模型与运行文件。
                </div>
                {readNotes(state, w.id, noteQuery).map((n) => (
                  <div className="note" key={n.id}>
                    <div className="note-meta">
                      {n.state} · v{n.revision} ·{' '}
                      {state.windows.find((x) => x.id === n.window)?.title}
                    </div>
                    <p>{n.summary || n.body.slice(0, 160)}</p>
                    <details>
                      <summary>查看完整原文和版本</summary>
                      <pre>{n.body}</pre>
                      <small>{n.tags.join(' · ')}</small>
                      {n.history.map((v) => (
                        <details key={v.revision}>
                          <summary>v{v.revision}</summary>
                          <pre>{v.body}</pre>
                        </details>
                      ))}
                    </details>
                  </div>
                ))}
                {!readNotes(state, w.id, noteQuery).length && (
                  <p className="empty">这里还没有匹配的记忆。让 AI 用记忆工具存下一件事吧。</p>
                )}
              </>
            )}
            {panel === 'context' && (
              <>
                <div className="usage-number">
                  {used.toLocaleString()}
                  <small>估算 tokens</small>
                </div>
                <p>按当前文字与工具记录估算，尚未计算图片令牌；不是供应商精确用量。</p>
                <label>
                  提醒阈值（0 关闭提醒）
                  <input
                    type="number"
                    min="0"
                    max="1000000"
                    value={threshold}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      if (Number.isInteger(n) && n >= 0 && n <= 1000000)
                        void change((s) => {
                          s.settings.threshold = n
                        })
                    }}
                  />
                </label>
                <p className="subtle">
                  达到 90% 时提醒 AI；是否及何时压缩由 AI 决定。阈值不改变模型的实际容量。
                </p>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={state.settings.preserveBranch}
                    onChange={(e) => {
                      const checked = e.target.checked
                      void change((s) => {
                        s.settings.preserveBranch = checked
                      })
                    }}
                  />
                  压缩前自动保存完整原文到新窗口
                </label>
                <button
                  className="primary"
                  disabled={!w.rollback || busy}
                  onClick={() => void undo()}
                >
                  撤销最近一次压缩
                </button>
                <p className="subtle">恢复压缩前记录，保留之后的新消息；只可撤销最近一次。</p>
                {w.compressions.map((e) => (
                  <div className="note" key={e.id}>
                    <strong>
                      {e.rolledBack ? '已撤销' : '已压缩'} · {e.before} → {e.after}
                    </strong>
                    <p>{new Date(e.at).toLocaleString()}</p>
                    {e.backupId && (
                      <button
                        onClick={() => {
                          setActive(e.backupId!)
                          setPanel('none')
                        }}
                      >
                        打开压缩前原文
                      </button>
                    )}
                  </div>
                ))}
              </>
            )}
            {panel === 'settings' && (
              <>
                <button className="profile-setting" onClick={openProfile}>我的称呼：{humanName || '未填写'} · {state.settings.userNameVisibleToAI === true && humanName ? 'AI 可见' : '仅页面显示'} →</button>
                <label>
                  AI 名称
                  <input
                    value={state.settings.name}
                    onChange={(e) => {
                      const value = e.target.value
                      void change((s) => {
                        s.settings.name = value
                      })
                    }}
                  />
                </label>
                <label>
                  人设与基础说明
                  <textarea
                    aria-label="人设与基础说明"
                    value={state.settings.prompt}
                    onChange={(e) => {
                      const value = e.target.value
                      void change((s) => {
                        s.settings.prompt = value
                      })
                    }}
                  />
                </label>
                <details className="configuration" open>
                  <summary>当前窗口 · 提示词与世界书</summary>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={conversation.enabled}
                      onChange={(e) => {
                        const checked = e.target.checked
                        void change((s) => {
                          const x = windowOf(s, w.id)
                          x.conversation = {
                            ...(x.conversation ?? defaultConversation()),
                            enabled: checked,
                          }
                        })
                      }}
                    />
                    启用补充提示词
                  </label>
                  <label>
                    本窗口补充提示词
                    <textarea
                      aria-label="本窗口补充提示词"
                      value={conversation.text}
                      onChange={(e) => {
                        const value = e.target.value
                        void change((s) => {
                          const x = windowOf(s, w.id)
                          x.conversation = {
                            ...(x.conversation ?? defaultConversation()),
                            text: value,
                          }
                        })
                      }}
                    />
                  </label>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={conversation.world_book_enabled}
                      onChange={(e) => {
                        const checked = e.target.checked
                        void change((s) => {
                          const x = windowOf(s, w.id)
                          x.conversation = {
                            ...(x.conversation ?? defaultConversation()),
                            world_book_enabled: checked,
                          }
                        })
                      }}
                    />
                    启用世界书
                  </label>
                  <label>
                    本窗口世界书
                    <textarea
                      aria-label="本窗口世界书"
                      value={conversation.world_book_text}
                      onChange={(e) => {
                        const value = e.target.value
                        void change((s) => {
                          const x = windowOf(s, w.id)
                          x.conversation = {
                            ...(x.conversation ?? defaultConversation()),
                            world_book_text: value,
                          }
                        })
                      }}
                      placeholder="人物、背景、关系或长期约定…"
                    />
                  </label>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={conversation.allowAI}
                      onChange={(e) => {
                        const checked = e.target.checked
                        void change((s) => {
                          const x = windowOf(s, w.id)
                          x.conversation = {
                            ...(x.conversation ?? defaultConversation()),
                            allowAI: checked,
                          }
                        })
                      }}
                    />
                    允许 AI 修改本窗口提示词和世界书
                  </label>
                  <p className="subtle">
                    与 Orbis 使用同名工具；仅影响本窗口，下轮生效。新窗口默认不开此权限。
                  </p>
                </details>
                <details className="configuration" open>
                  <summary>模型生成与上下文</summary>
                  <div className="field-row">
                    <label>
                      温度（留空默认）
                      <input
                        aria-label="温度"
                        type="number"
                        min="0"
                        max="2"
                        step="0.1"
                        value={options.temperature ?? ''}
                        placeholder="模型默认"
                        onChange={(e) =>
                          setOption(
                            'temperature',
                            e.target.value === '' ? null : Number(e.target.value)
                          )
                        }
                      />
                    </label>
                    <label>
                      Top-P（留空默认）
                      <input
                        aria-label="Top-P"
                        type="number"
                        min="0"
                        max="1"
                        step="0.05"
                        value={options.topP ?? ''}
                        placeholder="模型默认"
                        onChange={(e) =>
                          setOption('topP', e.target.value === '' ? null : Number(e.target.value))
                        }
                      />
                    </label>
                  </div>
                  <label>
                    思考等级
                    <select
                      aria-label="思考等级"
                      value={options.reasoning}
                      onChange={(e) => setOption('reasoning', e.target.value)}
                    >
                      {Object.entries({
                        auto: '模型默认',
                        off: '关闭',
                        low: '低',
                        medium: '中',
                        high: '高',
                        max: '最高',
                      }).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    最大输出 tokens
                    <input
                      type="number"
                      min="1"
                      max="131072"
                      value={options.maxTokens}
                      onChange={(e) => setOption('maxTokens', Math.max(1, Number(e.target.value)))}
                    />
                  </label>
                  <div className="field-row">
                    <label>
                      上下文最近轮数
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={options.contextTurns}
                        onChange={(e) =>
                          setOption('contextTurns', Math.max(0, Math.floor(Number(e.target.value))))
                        }
                      />
                    </label>
                    <label>
                      上下文文字预算
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={options.contextTokens}
                        onChange={(e) =>
                          setOption(
                            'contextTokens',
                            Math.max(0, Math.floor(Number(e.target.value)))
                          )
                        }
                      />
                    </label>
                  </div>
                  <p className="subtle">
                    截取填 0
                    表示不限；保留完整工具轮，最新一轮不会被裁断。只影响请求，不删除聊天。预算不含世界书、工具定义和图片精确用量。
                  </p>
                  {parameterWarnings(state.settings).map((t) => (
                    <p className="info" key={t}>
                      {t}
                    </p>
                  ))}
                </details>
                <div className="field-row">
                  <label>
                    接口协议
                    <select
                      value={state.settings.protocol}
                      onChange={(e) => {
                        const value = e.target.value
                        void change((s) => {
                          s.settings.protocol = value as 'messages' | 'openai'
                        })
                      }}
                    >
                      <option value="messages">Messages / DeepSeek</option>
                      <option value="openai">OpenAI-compatible</option>
                    </select>
                  </label>
                  <label>
                    模型名称
                    <input
                      value={state.settings.model}
                      onChange={(e) => {
                        const value = e.target.value
                        void change((s) => {
                          s.settings.model = value
                        })
                      }}
                    />
                  </label>
                </div>
                <label>
                  接口基础地址
                  <input
                    value={state.settings.endpoint}
                    onChange={(e) => {
                      const value = e.target.value
                      void change((s) => {
                        s.settings.endpoint = value
                      })
                    }}
                  />
                </label>
                <label>
                  API Key
                  <input
                    type="password"
                    autoComplete="off"
                    value={key}
                    placeholder="你自己的密钥"
                    onChange={(e) => {
                      setKey(e.target.value)
                      saveSecret('api', e.target.value)
                    }}
                  />
                </label>
                <p className="subtle">
                  密钥仅保存在本标签页会话中，不进入导出。接口需允许网页跨域。语音转写目前沿用
                  DeepSeek ASR。
                </p>
                <button onClick={() => setPanel('mcp')}>连接 MCP 与选择工具 →</button>
                <h3>聊天外观</h3>
                <label className="toggle">
                  <input type="checkbox" checked={thoughtOn} onChange={e => setThoughtOn(e.target.checked)}/>
                  启用人类思考链（当前窗口）
                </label>
                <p className="subtle">也可在输入框旁切换，或点思考输入区的「关闭」。关闭保留草稿，但新消息不会附带它；已发送的思考记录保留。</p>
                <label>界面主题<select aria-label="界面主题" value={appearance} onChange={e => { const value = e.target.value as 'orbis' | 'deepseek'; void change(s => { s.settings.appearance = value }) }}><option value="deepseek">DeepSeek · 简约蓝（仿官端）</option><option value="orbis">Orbis · 星夜</option></select></label>
                <p className="subtle">简约蓝沿用 Orbis 的仿官端配色；这里只切换外观，模型和记忆保持不变。此网页由 Orbis 提供。</p>
                <label>显示模式<select aria-label="显示模式" value={colorMode} onChange={e => { const value = e.target.value as 'light' | 'dark' | 'system'; void change(s => { s.settings.colorMode = value; s.settings.dark = value === 'dark' }) }}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">夜间</option></select></label>
                <h3>气泡样式</h3>
                <div className="style-grid">
                  {Object.entries(styles).map(([value, label]) => (
                    <button
                      key={value}
                      className={
                        'style-sample ' + value + (state.settings.style === value ? ' picked' : '')
                      }
                      onClick={() =>
                        void change((s) => {
                          s.settings.style = value as State['settings']['style']
                        })
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={state.settings.split}
                    onChange={(e) => {
                      const checked = e.target.checked
                      void change((s) => {
                        s.settings.split = checked
                      })
                    }}
                  />
                  按段落分割 AI 气泡
                </label>
                <div className="info">
                  网页版实验阶段：记忆库、压缩和基础工具已接入；关页后台哨兵尚未接入；语义召回的
                  iPhone 性能待实测。请先使用测试内容。
                </div>
              </>
            )}
            {panel === 'mcp' && (
              <>
                <p>
                  MCP 是可选功能，Safari 无法连接时可以跳过，不影响记忆和聊天。连接远程 Streamable
                  HTTP MCP，工具默认关闭，按需勾选。当前不支持本地 stdio 和旧式 SSE 连接。
                </p>
                <label>
                  连接名称
                  <input value={mcpName} onChange={(e) => setMcpName(e.target.value)} />
                </label>
                <label>
                  MCP 地址
                  <input
                    type="url"
                    value={mcpUrl}
                    onChange={(e) => setMcpUrl(e.target.value)}
                    placeholder="https://…/mcp"
                  />
                </label>
                <label>
                  Bearer Token（可选）
                  <input
                    type="password"
                    value={mcpKey}
                    onChange={(e) => setMcpKey(e.target.value)}
                  />
                </label>
                <button className="primary" disabled={!mcpUrl} onClick={() => void addMcp()}>
                  连接并读取工具
                </button>
                {state.mcp.map((c) => (
                  <div className="note" key={c.id}>
                    <h3>{c.name}</h3>
                    <small>
                      {c.tools.filter((t) => t.enabled).length} / {c.tools.length} 已启用
                    </small>
                    {c.tools.map((t) => (
                      <label className="toggle" key={t.name}>
                        <input
                          type="checkbox"
                          checked={t.enabled}
                          onChange={(e) => {
                            const checked = e.target.checked
                            void change((s) => {
                              const tool = s.mcp
                                .find((x) => x.id === c.id)
                                ?.tools.find((x) => x.name === t.name)
                              if (tool) tool.enabled = checked
                            })
                          }}
                        />
                        <span>
                          {t.name}
                          <small>{t.description?.slice(0, 180)}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                ))}
              </>
            )}
            {panel === 'sentinel' && (
              <>
                <div className="info">
                  本轮先提供网页打开期间的基础哨兵。关闭网页后不会后台生成；服务器哨兵与推送尚未接入。
                </div>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={state.settings.sentinelEnabled}
                    onChange={(e) => {
                      const checked = e.target.checked
                      void change((s) => {
                        s.settings.sentinelEnabled = checked
                      })
                    }}
                  />
                  允许基础哨兵与 AI 主动消息
                </label>
                <label>
                  触发方式
                  <select
                    value={ruleKind}
                    onChange={(e) => {
                      setRuleKind(e.target.value as typeof ruleKind)
                      setRuleAt('')
                    }}
                  >
                    <option value="once">未来某个时间</option>
                    <option value="interval">每隔一段时间</option>
                    <option value="daily">每天固定时间</option>
                  </select>
                </label>
                {ruleKind === 'interval' ? (
                  <label>
                    间隔分钟
                    <input
                      type="number"
                      min="1"
                      value={ruleInterval}
                      onChange={(e) => setRuleInterval(e.target.value)}
                    />
                  </label>
                ) : (
                  <label>
                    {ruleKind === 'daily' ? '每日时间' : '开始时间'}
                    <input
                      type={ruleKind === 'daily' ? 'time' : 'datetime-local'}
                      value={ruleAt}
                      onChange={(e) => setRuleAt(e.target.value)}
                    />
                  </label>
                )}
                <label>
                  交给 AI 的唤醒内容
                  <textarea
                    value={rulePrompt}
                    onChange={(e) => setRulePrompt(e.target.value)}
                    placeholder="例如：到了约定的时间，问问我今天过得怎么样"
                  />
                </label>
                <button className="primary" disabled={!rulePrompt} onClick={() => void addRule()}>
                  为当前窗口添加
                </button>
                {state.sentinels.map((r) => (
                  <div className="note" key={r.id}>
                    <strong>
                      {r.name} · {r.enabled ? '已启用' : '已暂停'}
                    </strong>
                    <p>{r.prompt}</p>
                    <small>
                      {state.windows.find((w) => w.id === r.window)?.title} ·{' '}
                      {new Date(r.due).toLocaleString()}
                    </small>
                    <small>{r.receipt}</small>
                    <button
                      onClick={() =>
                        void change((s) => {
                          sentinelAction(s, r.window, {
                            action: r.enabled ? 'pause' : 'resume',
                            id: r.id,
                          })
                        })
                      }
                    >
                      {r.enabled ? '暂停' : '恢复'}
                    </button>
                    <button
                      onClick={() =>
                        void change((s) => {
                          sentinelAction(s, r.window, { action: 'delete', id: r.id })
                        })
                      }
                    >
                      删除
                    </button>
                  </div>
                ))}
              </>
            )}
            {panel === 'backup' && (
              <>
                <p>把聊天、记忆和压缩前原文保存到自己手里。</p>
                <button
                  className="primary"
                  onClick={() => {
                    try {
                      download(
                        'Orbis-Web-' + new Date().toISOString().slice(0, 10) + '.zip',
                        fullBackup(state) as BlobPart,
                        'application/zip'
                      )
                    } catch (e) {
                      fail(e)
                    }
                  }}
                >
                  导出网页完整备份
                </button>
                <p className="subtle">
                  包含当前网页聊天、记忆和附件。此完整包目前用于网页版恢复，安卓完整导入器仍待实现。
                </p>
                <button
                  onClick={() =>
                    download(
                      'Orbis-通用聊天.json',
                      JSON.stringify(universalChat(state), null, 2),
                      'application/json'
                    )
                  }
                >
                  导出可供 Android Orbis 导入的聊天 JSON
                </button>
                <p className="subtle">
                  兼容入口只带文字、思考和时间；记忆与音频原件请保留在完整备份中。
                </p>
                <label className="import-file">
                  选择网页完整备份
                  <input
                    type="file"
                    accept=".zip"
                    onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                {importFile && (
                  <div className="info">
                    {importFile.name} · {bytes(importFile.size)}
                    <p>追加导入，不覆盖现有窗口；相同记录跳过。哨兵不自动恢复执行。</p>
                    <button
                      onClick={() =>
                        void (async () => {
                          const data = new Uint8Array(await importFile.arrayBuffer())
                          const r = await transact((s) => restoreBackup(s, data))
                          setState(r.state)
                          setNotice(`已追加 ${r.result.windows} 个窗口、${r.result.notes} 条记忆`)
                          setImportFile(null)
                        })().catch(fail)
                      }
                    >
                      确认追加导入
                    </button>
                  </div>
                )}
                <button
                  onClick={() =>
                    void navigator.storage
                      ?.persist()
                      .then((ok) =>
                        setNotice(ok ? '已获得持久存储许可' : '浏览器未授予持久存储，请定期导出')
                      )
                  }
                >
                  申请持久保存
                </button>
              </>
            )}
            <footer>Orbis Web Lite · 基于 DeepSeek chat-demo · AGPL-3.0 / MIT</footer>
          </section>
        </div>
      )}
    </div>
  )
}
