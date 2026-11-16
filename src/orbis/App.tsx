import { localTimestamp } from './clock.js'
import {
  registerVoiceHost,
  incomingCall,
  respondIncoming,
  boundCall,
  setActiveCall,
  clearActiveCall,
  type Invitation,
} from './voiceHost.js'
import { assetUrl } from './assets.js'
import { manual } from './help.js'
import { profileName } from './profile.js'
import { MessageActions, UsageRecord } from './MessageFooter.js'
import { SentinelTimeline } from './SentinelTimeline.js'
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
import {
  prepareSpeech,
  releaseSpeech,
  speakText,
  speechCredential,
  speechSettings,
  stopSpeech,
  transcribeSpeech,
} from './speech.js'
import { SpeechPanel } from './SpeechPanel.js'
import { KeyStorageChoice, StoragePanel } from './StoragePanel.js'
import { SearchResults } from './SearchResults.js'
import { supportsWeb } from './webSearch.js'
import { bubbles } from './bubbles.js'
import {
  claimSentinels,
  initialState,
  newWindow,
  readNotes,
  retract,
  rollback,
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
import { connectMcp } from './network.js'
import { generate, stopGeneration } from './runtime.js'
import { acquire, readState, saveSecret, secret, transact } from './storage.js'
import './style.css'
import { beginVoiceSession, finishVoiceSession, callDisplayMessages } from './callArchive.js'
import { summarizeVoiceSession, stopCallSummary } from './callSummary.js'
import { CallPanel, CallHistoryCard } from './CallPanel.js'
const modes: Record<Mode, string> = {
  light: '轻量 · 当前窗口',
  standard: '标准 · 跨窗按需',
  independent: '独立 · 跨窗充分',
}
const styles = { silk: '云绸', glass: '星雾', stars: '星芒', book: '书页' }
type Panel =
  | 'none'
  | 'memory'
  | 'context'
  | 'settings'
  | 'mcp'
  | 'sentinel'
  | 'backup'
  | 'help'
  | 'profile'
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
    [call, setCall] = useState(false),
    [voicePhase, setVoicePhase] = useState(''),
    [attachmentsOpen, setAttachmentsOpen] = useState(false)
  const [invitation, setInvitation] = useState<Invitation | undefined>()
  const [resumeAudio, setResumeAudio] = useState<(() => void) | undefined>()
  function playbackGate(resume: (() => void) | undefined) {
    setResumeAudio(() => resume)
    if (resume) { setVoicePhase('轻点开启声音') }
  }
  const acceptedCall = useRef<Invitation | undefined>(undefined)
  const activeSession = useRef<{ window: string; id: string } | undefined>()
  const pendingCallArchive = useRef<{ window: string; id: string; endedAt: number } | undefined>()
  const [callMinimized, setCallMinimized] = useState(false)
  const [callMicMuted, setCallMicMuted] = useState(false)
  const [callSpeakerMuted, setCallSpeakerMuted] = useState(false)
  const micMuted = useRef(false), speakerMuted = useRef(false)
  const sendRef = useRef(send)
  sendRef.current = send
  const hangupRef = useRef(hangup)
  hangupRef.current = hangup
  const activeRef = useRef(active)
  activeRef.current = active
  const expanded = state.settings.composerExpanded !== false
  const voiceRequest = useRef<AbortController | null>(null),
    recordingPending = useRef(false),
    recordingGeneration = useRef(0),
    recordingWindow = useRef(''),
    autoEndTimer = useRef<ReturnType<typeof setInterval> | null>(null)
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
      const r = await transact((s) => {
        s.settings.userName = profileName(profileDraft)
        s.settings.userNameVisibleToAI = profileVisible
      })
      setState(r.state)
      setPanel('none')
      setNotice('称呼已保存')
    } catch (e) {
      fail(e)
    } finally {
      setProfileSaving(false)
    }
  }
  const [systemDark, setSystemDark] = useState(
    () => matchMedia('(prefers-color-scheme: dark)').matches
  )
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
      clearVoiceTimer()
      voiceRequest.current?.abort()
      recordingGeneration.current++
      releaseSpeech()
      stopGeneration()
      stopCallSummary()
    }
  }, [])
  useEffect(() => {
    const update = () => setInvitation(incomingCall())
    window.addEventListener('orbis-incoming-call', update)
    const unregister = registerVoiceHost({
      available: (id) =>
        activeRef.current === id &&
        !callRef.current &&
        !recordingPending.current &&
        !recordingRef.current &&
        !voiceRequest.current,
      accept: (invite) => {
        prepareSpeech()
        activeSession.current = { window: invite.window, id: invite.id }
        setCallMinimized(false); setCallMicMuted(false); micMuted.current = false
        setCallSpeakerMuted(false); speakerMuted.current = false
        void transact((s) => beginVoiceSession(s, invite.window, invite.id)).catch(fail)
        acceptedCall.current = invite
      },
      end: () => hangupRef.current(false),
    })
    return () => {
      unregister()
      window.removeEventListener('orbis-incoming-call', update)
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
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        'content',
        deepseek ? (dark ? '#1a1a1a' : '#ffffff') : dark ? '#171f1c' : '#f5f2ec'
      )
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
            const done = await sendRef.current(e.window, e.prompt, [], true)
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
    let completed = false
    try {
      completed = await generate(
        windowId,
        text,
        attachments,
        event,
        setPartial,
        setState,
        humanThought,
        quoteId
      )
      return completed
    } catch (e) {
      fail(e)
      return false
    } finally {
      setPartial(null)
      setBusy(false)
      busyRef.current = false
      await refresh()
      const accepted = acceptedCall.current
      acceptedCall.current = undefined
      if (accepted && boundCall(accepted.window) === accepted.id) {
        if (completed && activeRef.current === accepted.window) {
          void openAcceptedCall(accepted)
        } else {
          hangup(false)
        }
      }
      if (pendingCallArchive.current) await finalizePendingCall()
    }
  }
  async function openAcceptedCall(invite: Invitation) {
    callRef.current = true
    setCall(true)
    recordingWindow.current = invite.window
    const controller = new AbortController()
    voiceRequest.current = controller
    try {
      const latest = await readState()
      if (!speechSettings(latest.settings).allowIncomingCalls) {
        throw Error('AI 来电权限已关闭')
      }
      const reply = windowOf(latest, invite.window)
        .messages.filter(
          (m) =>
            m.role === 'assistant' &&
            !m.calls?.length &&
            !m.voiceCall &&
            !m.voiceNote &&
            m.status === 'done' &&
            m.turn === invite.turn
        )
        .at(-1)
      if (reply?.text && !speakerMuted.current) {
        setVoicePhase('准备朗读')
        await speakText(reply.text, latest.settings, controller.signal, () =>
          setVoicePhase('正在说'), playbackGate
        ).catch((error) => {
          if (!(error instanceof DOMException && error.name === 'AbortError') || controller.signal.aborted) { throw error }
        })
      }
      if (!controller.signal.aborted && callRef.current) await beginRecord()
    } catch (e) {
      if (!controller.signal.aborted) {
        hangup()
        fail(e)
      }
    } finally {
      if (voiceRequest.current === controller) {
        voiceRequest.current = null
      }
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
        else if (
          f.type.startsWith('text/') ||
          /\.(txt|md|csv|json|log|js|ts|py|html|css|xml|yaml|yml)$/i.test(f.name)
        ) {
          if (f.size > 2 * 1048576) throw Error('文本附件暂支持 2 MiB 以内，请分段发送较大文件')
          const blob = new Blob([await f.text()], { type: 'text/plain' })
          next.push({
            id: uid(),
            name: f.name,
            mime: 'text/plain',
            data: await base64(blob),
            size: blob.size,
          })
        } else throw Error('目前支持图片和文本/代码文件；PDF、Word 等请先导出为文本')
      }
      setFiles((old) => [...old, ...next])
      setAttachmentsOpen(false)
    } catch (e) {
      fail(e)
    }
  }
  function clearVoiceTimer() {
    if (autoEndTimer.current) clearInterval(autoEndTimer.current)
    autoEndTimer.current = null
  }
  function hangup(stopModel = true) {
    if (activeSession.current) {
      pendingCallArchive.current = { ...activeSession.current, endedAt: Date.now() }
      activeSession.current = undefined
    }
    clearActiveCall()
    acceptedCall.current = undefined
    callRef.current = false
    setCall(false)
    recordingGeneration.current++
    recordingWindow.current = ''
    clearVoiceTimer()
    voiceRequest.current?.abort()
    voiceRequest.current = null
    recordingRef.current?.cancel()
    recordingRef.current = null
    setRecording(false)
    setVoiceBusy(false)
    setVoicePhase('')
    stopSpeech()
    if (stopModel) {
      stopGeneration()
    }
    if (!busyRef.current && pendingCallArchive.current) void finalizePendingCall()
  }
  async function finalizePendingCall() {
    const ended = pendingCallArchive.current
    if (!ended) return
    pendingCallArchive.current = undefined
    busyRef.current = true; setBusy(true)
    try {
      const saved = await transact((s) => finishVoiceSession(s, ended.window, ended.id, ended.endedAt))
      setState(saved.state)
      await summarizeVoiceSession(ended.window, ended.id)
    } catch (error) { fail(error) }
    finally { busyRef.current = false; setBusy(false); await refresh() }
  }
  async function retryCallSummary(id: string) {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true)
    try {
      await transact((s) => {
        const w = windowOf(s, active), c = w.voiceSessions?.find((c) => c.id === id)
        if (c?.status === 'active') finishVoiceSession(s, active, id,
          Math.max(c.startedAt, ...w.messages.filter((m) => m.voiceSessionId === id).map((m) => m.at)))
      })
      await summarizeVoiceSession(active, id, true)
    }
    catch (error) { fail(error) }
    finally { busyRef.current = false; setBusy(false); await refresh() }
  }
  function toggleCallMic() {
    micMuted.current = !micMuted.current; setCallMicMuted(micMuted.current)
    if (micMuted.current) {
      recordingGeneration.current++; clearVoiceTimer(); recordingRef.current?.cancel()
      recordingRef.current = null; setRecording(false)
      if (voicePhase === '正在转写') voiceRequest.current?.abort()
      if (!busyRef.current && voicePhase !== '正在说') setVoicePhase('麦克风已关闭')
    } else if (!busyRef.current && voicePhase !== '正在说') void beginRecord()
  }
  function toggleCallSpeaker() {
    speakerMuted.current = !speakerMuted.current; setCallSpeakerMuted(speakerMuted.current)
    if (speakerMuted.current) stopSpeech()
    else { prepareSpeech() }
  }
  useEffect(() => {
    if (
      (callRef.current ||
        recordingRef.current ||
        voiceRequest.current ||
        recordingPending.current) &&
      recordingWindow.current &&
      active &&
      recordingWindow.current !== active
    )
      hangup()
  }, [active])
  async function beginRecord() {
    if (callRef.current && micMuted.current) { setVoicePhase('麦克风已关闭'); return }
    if (recordingPending.current || recordingRef.current || !w) return
    const generation = ++recordingGeneration.current
    recordingPending.current = true
    recordingWindow.current = w.id
    try {
      speechCredential(state.settings, 'asr')
      const r = await startRecording(() => void finishRecord())
      if (generation !== recordingGeneration.current) {
        r.cancel()
        return
      }
      recordingRef.current = r
      setRecording(true)
      setVoicePhase('正在听')
      if (callRef.current && speechSettings(state.settings).autoSend) {
        const samples = new Float32Array(r.analyser.fftSize)
        let heard = false,
          voiced = 0,
          lastSpeech = performance.now()
        autoEndTimer.current = setInterval(() => {
          if (recordingRef.current !== r) {
            clearVoiceTimer()
            return
          }
          r.analyser.getFloatTimeDomainData(samples)
          const rms = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length)
          if (rms > 0.018) {
            voiced += 100
            lastSpeech = performance.now()
            if (voiced >= 300) heard = true
          }
          if (heard && performance.now() - lastSpeech > 1400) {
            clearVoiceTimer()
            void finishRecord()
          }
        }, 100)
      }
    } catch (e) {
      hangup()
      fail(e)
    } finally {
      recordingPending.current = false
    }
  }
  async function finishRecord() {
    const r = recordingRef.current,
      windowId = recordingWindow.current,
      generation = recordingGeneration.current
    if (!r || !windowId) return
    recordingRef.current = null
    clearVoiceTimer()
    setRecording(false)
    setVoiceBusy(true)
    setVoicePhase('正在转写')
    const controller = new AbortController()
    voiceRequest.current = controller
    try {
      const blob = await r.stop()
      if (!blob) throw Error('没有录到声音')
      const latestSettings = (await readState()).settings
      const text = await transcribeSpeech(latestSettings, blob, controller.signal)
      if (controller.signal.aborted || generation !== recordingGeneration.current) return
      const file: Attachment = {
        id: uid(),
        name: '语音.wav',
        mime: 'audio/wav',
        data: await base64(blob),
        size: blob.size,
      }
      if (controller.signal.aborted || generation !== recordingGeneration.current) return
      setVoicePhase('正在回复')
      const ok = await sendRef.current(windowId, text, [file])
      if (
        ok &&
        callRef.current &&
        !controller.signal.aborted &&
        generation === recordingGeneration.current
      ) {
        const latest = await readState()
        const reply = windowOf(latest, windowId)
          .messages.filter(
            (m) => m.role === 'assistant' && !m.calls?.length && !m.retracted && m.status === 'done'
          )
          .at(-1)
        if (reply?.text && !speakerMuted.current) {
          setVoicePhase('准备朗读')
          try {
            await speakText(reply.text, latest.settings, controller.signal, () =>
              setVoicePhase('正在说'), playbackGate
            )
          } catch (e) {
            if (!(e instanceof DOMException && e.name === 'AbortError')) throw e
          }
        }
        if (
          callRef.current &&
          !controller.signal.aborted &&
          generation === recordingGeneration.current
        ) {
          await beginRecord()
        }
      } else if (callRef.current && !ok) hangup()
    } catch (e) {
      if (!controller.signal.aborted) {
        hangup()
        fail(e)
      }
    } finally {
      if (voiceRequest.current === controller) {
        voiceRequest.current = null
        setVoiceBusy(false)
        if (!callRef.current) setVoicePhase('')
      }
    }
  }
  async function speak(text: string): Promise<void> {
    try {
      prepareSpeech()
      await speakText(text, state.settings, undefined, undefined, playbackGate)
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) fail(e)
    }
  }
  async function toggleCall() {
    if (callRef.current) {
      hangup()
      return
    }
    if (busy || voiceBusy || recordingPending.current || recordingRef.current) return
    if (!secret('api')) {
      setPanel('settings')
      return
    }
    try {
      speechCredential(state.settings, 'asr')
      if (speechSettings(state.settings).ttsProvider === 'deepseek')
        speechCredential(state.settings, 'tts')
      prepareSpeech()
    } catch (e) {
      setPanel('settings')
      fail(e)
      return
    }
    const id = uid()
    await transact((s) => beginVoiceSession(s, active, id))
    activeSession.current = { window: active, id }
    setActiveCall(active, id)
    setCallMinimized(false); setCallMicMuted(false); micMuted.current = false
    setCallSpeakerMuted(false); speakerMuted.current = false
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
  const shown = w ? callDisplayMessages(w, w.messages.map((m) => (partial?.id === m.id ? partial : m))) : []
  if (!ready) return <div className="loading">✦ 正在打开你的 Orbis…</div>
  return (
    <div className={'orbis ' + state.settings.style + (deepseek ? ' deepseek' : '')}>
      <aside className={'sidebar ' + (drawer ? 'open' : '')}>
        <div className="brand">
          <span className="orb">
            {deepseek ? <img src={assetUrl('deepseek.svg')} alt="" /> : '✦'}
          </span>
          <div>
            Orbis <small>WEB LITE · 实验版</small>
          </div>
          <button className="mobile-only" onClick={() => setDrawer(false)} aria-label="收起窗口">
            ×
          </button>
        </div>
        <button className="user-profile" onClick={openProfile} aria-label="修改我的称呼">
          <span className="profile-avatar" aria-hidden="true">
            {Array.from(humanName)[0] || '○'}
          </span>
          <span>
            <strong>{humanName || '设置你的称呼'}</strong>
            <small>欢迎回家 · 修改称呼</small>
          </span>
          <span aria-hidden="true">✎</span>
        </button>
        <button disabled={switching} className="new-window" onClick={() => void addWindow()}>
          ＋ 开一个新窗口
        </button>
        <label className="window-search">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="搜索对话"
            placeholder="搜索对话内容…"
            value={windowQuery}
            onChange={(e) => setWindowQuery(e.target.value)}
          />
        </label>
        <div className="section-caption">{windowQuery ? '搜索结果' : '最近对话'}</div>
        <nav className="windows">
          {[...state.windows]
            .filter(
              (x) =>
                !windowQuery.trim() ||
                (
                  x.title +
                  '\n' +
                  x.messages
                    .filter((m) => !m.retracted)
                    .map((m) => m.text)
                    .join('\n')
                )
                  .toLocaleLowerCase()
                  .includes(windowQuery.trim().toLocaleLowerCase())
            )
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
            <svg
              viewBox="0 0 24 24"
              width="25"
              height="25"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M4 7h16M4 16h10" />
            </svg>
          </button>
          <div className="identity">
            <span className="avatar">
              {deepseek ? <img src={assetUrl('deepseek.svg')} alt="" /> : '✦'}
            </span>
            <div>
              <strong>{state.settings.name}</strong>
              <small>{w?.title}</small>
            </div>
          </div>
          <div className="header-actions">
            <button
              className="header-new"
              onClick={() => void addWindow()}
              disabled={switching}
              aria-label="新建对话"
            >
              <svg
                viewBox="0 0 24 24"
                width="24"
                height="24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path d="M20 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-4.7A8.5 8.5 0 1 1 20 11.5Z" />
                <path d="M8 11.5h8M12 7.5v8" />
              </svg>
            </button>
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
              {call ? '挂断' : '电话'}
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
        <div className={'messages' + (!shown.length ? ' is-empty' : '')} ref={listRef}>
          {!state.settings.tutorialSeen && (
            <div className="first-guide">
              <button onClick={() => setPanel('help')}>第一次使用？查看连接与记忆指引 ↗</button>
              <button
                aria-label="收起入门提示"
                onClick={() =>
                  void change((s) => {
                    s.settings.tutorialSeen = true
                  })
                }
              >
                ×
              </button>
            </div>
          )}
          {!shown.length && (
            <div className="welcome">
              <div className="welcome-orb">
                {deepseek ? <img src={assetUrl('deepseek.svg')} alt="DeepSeek" /> : '✦'}
              </div>
              <h1>{humanName ? `${humanName}，欢迎回家` : '欢迎回家'}</h1>
              {!humanName && (
                <button className="welcome-profile" onClick={openProfile}>
                  告诉 Orbis 怎么称呼你
                </button>
              )}
              {!deepseek && (
                <div className="suggestions">
                  <button onClick={() => setDraft('请把这件事存进记忆库：')}>记住一件事 ↗</button>
                  <button onClick={() => setPanel('memory')}>看看记忆库 ↗</button>
                </div>
              )}
            </div>
          )}
          {shown.map((m) => (
            <article key={m.id} className={'message ' + (m.role === 'user' && m.event ? 'sentinel-event' : m.role)} id={'msg-' + m.id}>
              {m.voiceSessionEnd ? (
                <CallHistoryCard call={w.voiceSessions!.find((c) => c.id === m.voiceSessionEnd)!}
                  messages={w.messages} name={state.settings.name} live={call && activeSession.current?.id === m.voiceSessionEnd}
                  busy={busy} onRetry={() => void retryCallSummary(m.voiceSessionEnd!)} onReturn={() => setCallMinimized(false)} />
              ) : m.role === 'user' && m.event ? (
                <SentinelTimeline message={m}>
                  {!m.retracted && <MessageActions message={m} disabled={busy}
                    quote={() => { setQuote(m.id); pendingFocus.current = true }}
                    copy={() => void navigator.clipboard.writeText(m.text).then(() => setNotice('已复制')).catch(fail)}
                    revoke={() => void revoke(m)} speak={() => void speak(m.text)} />}
                </SentinelTimeline>
              ) : m.role === 'tool' ? (
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
                      {bubbles(
                        m.voiceNote || m.voiceCall ? '' : m.text,
                        state.settings.split && m.role === 'assistant'
                      )
                        .filter(
                          (part) => part.trim() || (m.status === 'working' && !m.calls?.length)
                        )
                        .map((part, i) => (
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
                        ))}
                      {m.files?.map((f) =>
                        f.mime.startsWith('image/') ? (
                          <img className="attachment" key={f.id} src={f.data} alt={f.name} />
                        ) : f.mime.startsWith('audio/') ? (
                          <audio key={f.id} controls src={f.data} />
                        ) : null
                      )}
                      {m.voiceNote && (
                        <details className="voice-transcript">
                          <summary>语音文字</summary>
                          <p>{m.text}</p>
                        </details>
                      )}
                      {m.voiceCall && (
                        <div className="call-history">
                          电话邀请 · {m.voiceCall.reason}
                          <small>
                            {(
                              {
                                waiting: '等待接听（页面重开后不重拨）',
                                accepted: '已接听',
                                rejected: '已拒绝',
                                no_response: '未接听',
                                unavailable: '页面当前无法接听',
                                cancelled: '已取消',
                                failed: '未能接通',
                              } as Record<string, string>
                            )[m.voiceCall.status] ?? '已结束'}
                          </small>
                        </div>
                      )}
                      <SearchResults message={m} />
                      {m.calls?.length ? (
                        <details className="tool">
                          <summary>◇ {m.calls.map((c) => c.name).join('、')}</summary>
                          <pre>{JSON.stringify(m.calls, null, 2)}</pre>
                        </details>
                      ) : null}
                      {(m.text || m.role === 'user') && (
                        <MessageActions
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
                        />
                      )}
                      {m.role === 'assistant' && m.status !== 'working' && (
                        <UsageRecord message={m} />
                      )}
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
          {resumeAudio && !call && <div className="storage-reminder" role="status">
            <span>浏览器暂停了声音，文字已保留。</span><button onClick={resumeAudio}>开启声音并播放</button>
            <button onClick={stopSpeech}>取消播放</button>
          </div>}
          {call && (
            <CallPanel name={state.settings.name} deepseek={deepseek} minimized={callMinimized}
              startedAt={w.voiceSessions?.find((c) => c.id === activeSession.current?.id)?.startedAt ?? Date.now()}
              phase={voicePhase || (recording ? '正在听' : '准备下一句')} recording={recording}
              caption={partial?.text || w.messages.filter((m) => m.voiceSessionId === activeSession.current?.id && m.role !== 'tool' && !m.voiceCall && !m.calls?.length).at(-1)?.text || '接通了，随时开口。'}
              captionKey={partial?.id || w.messages.filter((m) => m.voiceSessionId === activeSession.current?.id && m.role !== 'tool' && !m.voiceCall && !m.calls?.length).at(-1)?.id || ''}
              micMuted={callMicMuted} speakerMuted={callSpeakerMuted} onResumeAudio={resumeAudio}
              onMinimize={() => setCallMinimized(true)} onExpand={() => setCallMinimized(false)}
              onMic={toggleCallMic} onSpeaker={toggleCallSpeaker} onHangup={() => hangup()}
              onFinish={() => void finishRecord()} onInterrupt={() => { stopSpeech(); setVoicePhase('准备下一句') }} />
          )}
          {expanded && !state.settings.storageNoticeSeen && (
            <div className="storage-reminder">
              <span>聊天与配置只存在此打开方式。清除“网站数据”会删除资料。</span>
              <button onClick={() => setPanel('backup')}>清理前看这里</button>
              <button
                aria-label="关闭本地存储提醒"
                onClick={() =>
                  void change((s) => {
                    s.settings.storageNoticeSeen = true
                  })
                }
              >
                ×
              </button>
            </div>
          )}
          {invitation && (
            <div className="incoming-call" role="dialog" aria-label="AI 来电">
              <strong>{state.settings.name} 来电</strong>
              <p>{invitation.reason}</p>
              <small>
                接听后才开始语音 · 最多等待{' '}
                {Math.max(1, Math.ceil((invitation.deadline - Date.now()) / 1000))} 秒
              </small>
              <div>
                <button onClick={() => respondIncoming(false)}>拒绝</button>
                <button onClick={() => respondIncoming(true)}>接听</button>
              </div>
            </div>
          )}
          {recording && !call && (
            <div className="recording-strip">
              正在录音 <button onClick={() => void finishRecord()}>发送语音</button>
              <button onClick={() => hangup()}>取消录音</button>
            </div>
          )}
          <div className={'composer ' + (expanded ? 'expanded' : 'minimized')}>
            {quote && (
              <div className="quote">
                引用：{w.messages.find((m) => m.id === quote)?.text.slice(0, 90)}
                <button onClick={() => setQuote(undefined)}>×</button>
              </div>
            )}
            {thoughtOn && (
              <div className="human-thought-editor">
                <div>
                  <span>人类思考链 · 会随正文发给 AI</span>
                  <button aria-label="关闭人类思考链" onClick={() => setThoughtOn(false)}>
                    关闭 ×
                  </button>
                </div>
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
            <div className="composer-input-row">
              <button
                className="expand-composer"
                aria-label={expanded ? '收起输入工具' : '展开输入工具'}
                aria-expanded={expanded}
                onClick={() => {
                  setAttachmentsOpen(false)
                  void change((s) => {
                    s.settings.composerExpanded = !expanded
                  })
                }}
              >
                {expanded ? '×' : '＋'}
              </button>
              <textarea
                rows={1}
                disabled={switching}
                aria-label="输入消息"
                placeholder={deepseek ? '发消息，或点击语音说话' : '想说的话，慢慢说…'}
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
              {busy ? (
                <button
                  className="send"
                  onClick={() => {
                    stopGeneration()
                    stopCallSummary()
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
            {expanded && (
              <div className="composer-tools">
                {deepseek && (
                  <button
                    className={'reasoning-toggle ' + (options.reasoning !== 'off' ? 'enabled' : '')}
                    aria-label="深度思考"
                    aria-pressed={options.reasoning !== 'off'}
                    onClick={() =>
                      setOption('reasoning', options.reasoning === 'off' ? 'high' : 'off')
                    }
                    title="切换 AI 深度思考；具体能力取决于所选模型"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      aria-hidden="true"
                    >
                      <ellipse cx="12" cy="12" rx="4" ry="10" transform="rotate(45 12 12)" />
                      <ellipse cx="12" cy="12" rx="4" ry="10" transform="rotate(-45 12 12)" />
                      <circle cx="12" cy="12" r="1" />
                    </svg>
                    深思
                  </button>
                )}
                <button
                  className={'search-toggle ' + (state.settings.webSearch ? 'enabled' : '')}
                  aria-label="智能搜索"
                  aria-pressed={!!state.settings.webSearch}
                  disabled={busy || call}
                  onClick={() => {
                    if (!state.settings.webSearch && !supportsWeb(state.settings)) {
                      setNotice('智能搜索使用 DeepSeek 官方 deepseek-flash，请在连接设置选择')
                      setPanel('settings')
                      return
                    }
                    void change((s) => {
                      s.settings.webSearch = !s.settings.webSearch
                    })
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <ellipse cx="12" cy="12" rx="4" ry="9" />
                    <path d="M3 12h18" />
                  </svg>
                  搜索
                </button>
                <button
                  className="attach-toggle"
                  aria-label="添加附件"
                  aria-expanded={attachmentsOpen}
                  onClick={() => setAttachmentsOpen((x) => !x)}
                >
                  {attachmentsOpen ? '×' : '＋'}
                </button>
                <button
                  className={'human-thought ' + (thoughtOn ? 'enabled' : '')}
                  onClick={() => setThoughtOn((x) => !x)}
                  aria-pressed={thoughtOn}
                  aria-label="人类思考链"
                  title={thoughtOn ? '点击关闭人类思考链' : '点击开启人类思考链'}
                >
                  思考链 · {thoughtOn ? '开' : '关'}
                </button>
                <button
                  className="voice-button"
                  aria-label={recording ? '结束录音' : '录制语音条'}
                  disabled={voiceBusy || (busy && !recording)}
                  onClick={() => void (recording ? finishRecord() : beginRecord())}
                >
                  {recording ? '发送' : voiceBusy ? '转写' : '语音'}
                </button>
                <button
                  className="toolbar-call"
                  aria-label="拨打电话"
                  onClick={() => void toggleCall()}
                >
                  {call ? '挂断' : '电话'}
                </button>
              </div>
            )}
          </div>
          {attachmentsOpen && (
            <div className="attachment-drawer" aria-label="选择附件类型">
              <label>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 6h4l2-3h4l2 3h4v14H4z" />
                  <circle cx="12" cy="12" r="4" />
                </svg>
                拍照
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => {
                    void importAttachments(e.target.files)
                    e.target.value = ''
                  }}
                />
              </label>
              <label>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                  <circle cx="8" cy="8" r="2" />
                  <path d="m4 19 6-6 3 3 4-5 4 5" />
                </svg>
                相册
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => {
                    void importAttachments(e.target.files)
                    e.target.value = ''
                  }}
                />
              </label>
              <label>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m9 15 7-7a3 3 0 0 0-4-4l-8 8a5 5 0 0 0 7 7l9-9M7 13l8-8" />
                </svg>
                文件
                <input
                  type="file"
                  accept="image/*,text/*,.txt,.md,.csv,.json,.log,.js,.ts,.py,.html,.css,.xml,.yaml,.yml"
                  multiple
                  onChange={(e) => {
                    void importAttachments(e.target.files)
                    e.target.value = ''
                  }}
                />
              </label>
            </div>
          )}
          {expanded && (
            <div className="composer-foot">
              Orbis Web Lite ·{' '}
              <button onClick={() => setPanel('backup')}>本地存储与清理提醒</button> ·{' '}
              <button onClick={() => setPanel('backup')}>导出留存</button> ·{' '}
              <a href={assetUrl('source.tar.gz')} download>
                源码
              </a>
            </div>
          )}
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
                    backup: '本地存储与备份',
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
              <form
                className="profile-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  void saveProfile()
                }}
              >
                <label>
                  你的称呼
                  <input
                    aria-label="你的称呼"
                    autoFocus
                    maxLength={120}
                    value={profileDraft}
                    onChange={(e) => setProfileDraft(e.target.value)}
                    placeholder="想让 Orbis 怎么称呼你？"
                  />
                </label>
                <p className="profile-preview">
                  {profileName(profileDraft)
                    ? `${profileName(profileDraft)}，欢迎回家`
                    : '欢迎回家'}
                </p>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={profileVisible}
                    onChange={(e) => setProfileVisible(e.target.checked)}
                  />
                  AI 可见
                </label>
                <p className="hint">
                  开启后，从下一次发消息开始，AI
                  就能知道你的称呼，所有窗口通用。默认关闭，仅用于页面欢迎语。
                </p>
                <p className="hint">
                  关闭后不再主动发送称呼，已经发给 AI 的聊天记录不会删除。称呼最多 60
                  个字，保存在此浏览器。
                </p>
                <button className="primary" type="submit" disabled={profileSaving}>
                  {profileSaving ? '保存中…' : '保存称呼'}
                </button>
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
                <button className="profile-setting" onClick={openProfile}>
                  我的称呼：{humanName || '未填写'} ·{' '}
                  {state.settings.userNameVisibleToAI === true && humanName
                    ? 'AI 可见'
                    : '仅页面显示'}{' '}
                  →
                </button>
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
                      try {
                        saveSecret('api', e.target.value)
                        setKey(e.target.value)
                      } catch (error) {
                        fail(error)
                      }
                    }}
                  />
                </label>
                <KeyStorageChoice fail={fail} />
                <p className="subtle">
                  接口需允许网页跨域。智能搜索当前支持 DeepSeek 官方
                  deepseek-flash，开启后按服务用量计费；搜索来源会显示在回复中。
                </p>
                <SpeechPanel settings={state.settings} change={change} fail={fail} />
                <button onClick={() => setPanel('mcp')}>连接 MCP 与选择工具 →</button>
                <h3>聊天外观</h3>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={thoughtOn}
                    onChange={(e) => setThoughtOn(e.target.checked)}
                  />
                  启用人类思考链（当前窗口）
                </label>
                <p className="subtle">
                  也可在输入框旁切换，或点思考输入区的「关闭」。关闭保留草稿，但新消息不会附带它；已发送的思考记录保留。
                </p>
                <label>
                  界面主题
                  <select
                    aria-label="界面主题"
                    value={appearance}
                    onChange={(e) => {
                      const value = e.target.value as 'orbis' | 'deepseek'
                      void change((s) => {
                        s.settings.appearance = value
                      })
                    }}
                  >
                    <option value="deepseek">DeepSeek · 简约蓝（仿官端）</option>
                    <option value="orbis">Orbis · 星夜</option>
                  </select>
                </label>
                <p className="subtle">
                  简约蓝沿用 Orbis 的仿官端配色；这里只切换外观，模型和记忆保持不变。此网页由 Orbis
                  提供。
                </p>
                <label>
                  显示模式
                  <select
                    aria-label="显示模式"
                    value={colorMode}
                    onChange={(e) => {
                      const value = e.target.value as 'light' | 'dark' | 'system'
                      void change((s) => {
                        s.settings.colorMode = value
                        s.settings.dark = value === 'dark'
                      })
                    }}
                  >
                    <option value="system">跟随系统</option>
                    <option value="light">浅色</option>
                    <option value="dark">夜间</option>
                  </select>
                </label>
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
                <p>你只需决定是否授权。开启后，AI 可在对话中自主设定唤醒时间、内容，并管理自己的规则。</p>
                <p className="info">{state.settings.sentinelEnabled ? '已授权。开启不等于已设定规则；AI 从下一条消息起可使用哨兵工具。' : '尚未授权。已有规则保留，但不会触发；AI 无法自行打开总开关。'}</p>
                {!state.sentinels.length && <p>暂时没有规则。无需在这里填写内容，AI 会根据对话自行安排。</p>}
                {state.sentinels.map((r) => (
                  <div className="note" key={r.id}>
                    <strong>
                      {r.name} · {r.enabled ? (state.settings.sentinelEnabled ? '已启用' : '授权关闭，暂不触发') : '已暂停'}
                    </strong>
                    <p>{r.prompt}</p>
                    <small>
                      {state.windows.find((w) => w.id === r.window)?.title} ·{' '}
                      {localTimestamp(r.due, r.timezone)} · {r.timezone}
                    </small>
                    <small>{r.receipt}</small>
                  </div>
                ))}
              </>
            )}
            {panel === 'backup' && (
              <StoragePanel
                state={state}
                onState={(s) => {
                  setState(s)
                  setKey(secret('api'))
                }}
                notify={setNotice}
                fail={fail}
                busy={busy || voiceBusy || call}
              />
            )}
            <footer>Orbis Web Lite · 基于 DeepSeek chat-demo · AGPL-3.0 / MIT</footer>
          </section>
        </div>
      )}
    </div>
  )
}
