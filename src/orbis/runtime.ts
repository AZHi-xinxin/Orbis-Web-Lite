import { executeVoice } from './voiceTools.js'
import { boundCall } from './voiceHost.js'
import {
  compact,
  retract,
  freezeMemory,
  memoryAction,
  readWindow,
  searchWindows,
  sentinelAction,
  textOf,
  tokens,
  uid,
  windowOf,
  type Attachment,
  type Message,
  type State,
} from './core.js'
import { acquire, readState, transact } from './storage.js'
import { builtins, callMcp, enabledTools, mcpAlias, streamModel, type Output } from './network.js'
import { conversationSettings } from './configuration.js'
import { helpTopic } from './help.js'
import { finishWeb, searchTools } from './webSearch.js'
import { recall, windowNotice } from './semantic.js'
let current: AbortController | undefined
export const stopGeneration = () => current?.abort()
async function execute(
  window: string,
  turn: string,
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
  toolCall: string,
  bound?: string
): Promise<unknown> {
  if (signal.aborted) throw new DOMException('已停止', 'AbortError')
  const s = await readState()
  if (!enabledTools(s, window).some((t) => t.name === name)) throw Error('此工具已关闭或不存在')
  if (!builtins.some((t) => t.name === name)) {
    for (const c of s.mcp) {
      const t = c.tools.find((t) => t.enabled && mcpAlias(c.id, t.name) === name)
      if (t) return callMcp(c, t.name, args, signal)
    }
    throw Error('MCP 工具不存在')
  }
  if (['orbis_voice_note', 'start_voice_call', 'end_voice_call'].includes(name)) {
    return executeVoice(window, turn, toolCall, name, args, signal, bound)
  }
  return (
    await transact((s) => {
      if (name === 'orbis_reply') {
        if (args.action === 'retract')
          return retract(s, window, String(args.target_message_id), 'assistant')
        const w = windowOf(s, window),
          source = w.messages.find((m) => m.id === args.target_message_id && !m.retracted)
        if (!source) throw Error('引用来源不可用')
        return { quote_message_id: source.id }
      }
      if (name === 'orbis_help') return helpTopic(String(args.topic ?? 'overview'))
      if (name === 'orbis_conversation_settings')
        return conversationSettings(windowOf(s, window), args)
      if (name === 'orbis_memory') return memoryAction(s, window, args)
      if (name === 'conversation_search') return searchWindows(s, window, String(args.query ?? ''))
      if (name === 'conversation_read')
        return readWindow(
          s,
          window,
          String(args.window_id ?? window),
          Number(args.offset ?? 0),
          Number(args.limit ?? 20)
        )
      if (name === 'compact') {
        const w = windowOf(s, window)
        return compact(
          s,
          window,
          String(args.summary ?? ''),
          Number(args.keep_recent ?? Math.min(32, w.messages.length)),
          turn
        )
      }
      if (name === 'context_compaction_status') {
        const w = windowOf(s, window)
        return {
          estimated_tokens: tokens(textOf(w)),
          threshold: s.settings.threshold,
          mode: w.mode,
          compressions: w.compressions,
        }
      }
      if (name === 'orbis_sentinel') return sentinelAction(s, window, args)
      throw Error('未知工具')
    })
  ).result
}
export async function generate(
  window: string,
  text: string,
  files: Attachment[],
  event: boolean,
  onStream: (m: Message) => void,
  onState: (s: State) => void,
  thought?: string,
  quoteId?: string
): Promise<boolean> {
  if (current) throw Error('已有回复正在进行')
  const controller = new AbortController()
  current = controller
  let release: (() => Promise<void>) | undefined
  let responseId: string | undefined
  let requestStarted = 0
  let streamedUsage: Message['usage']
  let streamedWeb: Message['web']
  let nextQuote: string | undefined
  let streamedText = '',
    streamedReasoning = ''
  const turnId = uid()
  const callBinding = boundCall(window)
  try {
    searchTools((await readState()).settings)
    release = await acquire(window)
    if (controller.signal.aborted) return false
    const remembered = event
      ? { selection: [] }
      : await recall(await readState(), window, text, controller.signal)
    if (controller.signal.aborted) return false
    if (remembered.error)
      windowNotice('本地语义召回暂不可用：' + remembered.error + '；本轮继续使用关键词与工具查询')
    const begin = await transact((s) => {
      const w = windowOf(s, window)
      const m: Message = {
        id: uid(),
        turn: turnId,
        role: 'user',
        text,
        at: Date.now(),
        files,
        event,
        thought,
        quoteId,
      }
      w.messages.push(m)
      w.at = Date.now()
      if (w.title === '新的聊天') w.title = text.slice(0, 24) || '语音聊天'
      return freezeMemory(s, window, turnId, event ? '' : text, remembered.selection)
    })
    onState(begin.state)
    const turn = begin.result
    for (let step = 0; step < 12; step++) {
      if (controller.signal.aborted) break
      responseId = uid()
      streamedText = ''
      streamedReasoning = ''
      streamedWeb = undefined
      const id = responseId
      const start = await transact((s) => {
        windowOf(s, window).messages.push({
          id,
          turn: turnId,
          role: 'assistant',
          text: '',
          at: Date.now(),
          status: 'working',
          quoteId: nextQuote,
        })
      })
      nextQuote = undefined
      onState(start.state)
      const snapshot = await readState(),
        w = windowOf(snapshot, window),
        tools = enabledTools(snapshot, window)
      const base = w.messages.find((m) => m.id === id)!
      requestStarted = performance.now()
      streamedUsage = undefined
      const result: Output = await streamModel(
        snapshot,
        { ...w, messages: w.messages.filter((m) => m.id !== id) },
        turn,
        tools,
        controller.signal,
        (o) => {
          streamedText = o.text
          streamedReasoning = o.reasoning
          streamedUsage = o.usage
          streamedWeb = o.web
          onStream({ ...base, text: o.text, reasoning: o.reasoning, calls: o.calls, web: o.web })
        }
      )
      const saved = await transact((s) => {
        const m = windowOf(s, window).messages.find((m) => m.id === id)
        if (!m) throw Error('回复窗口已改变')
        Object.assign(m, {
          text: result.text,
          reasoning: result.reasoning,
          thinkingBlocks: result.thinkingBlocks,
          calls: result.calls,
          web: result.web,
          providerContent: result.providerContent,
          serverToolCalls: result.serverToolCalls,
          providerIdentity: result.providerIdentity,
          status: 'done',
          usage: result.usage,
          elapsedMs: Math.max(0, performance.now() - requestStarted),
        })
      })
      onState(saved.state)
      if (!result.calls.length) return true
      for (const call of result.calls) {
        const toolId = uid()
        const pending = await transact((s) =>
          windowOf(s, window).messages.push({
            id: toolId,
            turn: turnId,
            role: 'tool',
            callId: call.id,
            text: controller.signal.aborted
              ? '已停止，未执行此工具。'
              : '工具执行中；若本页中断，执行结果未知，不自动重试。',
            at: Date.now(),
            status: controller.signal.aborted ? 'stopped' : 'working',
          })
        )
        onState(pending.state)
        if (controller.signal.aborted) continue
        let value: unknown
        try {
          value = await execute(
            window,
            turnId,
            call.name,
            JSON.parse(call.arguments || '{}'),
            controller.signal,
            call.id,
            callBinding
          )
        } catch (e) {
          value = {
            error: e instanceof Error ? e.message : String(e),
            execution: controller.signal.aborted
              ? '执行状态请以实际结果为准，不自动重试'
              : 'failed',
          }
        }
        if (
          call.name === 'orbis_reply' &&
          value &&
          typeof value === 'object' &&
          'quote_message_id' in value
        )
          nextQuote = String(value.quote_message_id)
        const end = await transact((s) => {
          const m = windowOf(s, window).messages.find((m) => m.id === toolId)
          if (m) {
            m.text = JSON.stringify(value)
            m.status = controller.signal.aborted ? 'stopped' : 'done'
          }
        })
        onState(end.state)
      }
    }
    if (!controller.signal.aborted)
      throw Error('本轮已完成 12 次工具续轮，已暂停；需要时请继续发言')
  } catch (e) {
    if (responseId) {
      const id = responseId
      try {
        const r = await transact((s) => {
          const m = windowOf(s, window).messages.find((m) => m.id === id)
          if (m && m.status === 'working') {
            m.status = controller.signal.aborted ? 'stopped' : 'error'
            m.reasoning = streamedReasoning
            m.usage = streamedUsage
            if (streamedWeb) {
              finishWeb(streamedWeb)
              m.web = structuredClone(streamedWeb)
            }
            if (requestStarted) m.elapsedMs = Math.max(0, performance.now() - requestStarted)
            m.text = streamedText || m.text
            m.text ||= controller.signal.aborted
              ? '已停止。'
              : e instanceof Error
                ? e.message
                : String(e)
          }
        })
        onState(r.state)
      } catch {}
    }
    if (!controller.signal.aborted) throw e
  } finally {
    if (current === controller) current = undefined
    await release?.()
  }
  return false
}
