import { boundCall } from './voiceHost.js'
import { messageTimestamp } from './clock.js'
import {
  applyCitation,
  applyOpenAIWeb,
  applyWebBlock,
  emptyWeb,
  finishWeb,
  providerIdentity,
  searchTools,
  supportsWeb,
  type WebResult,
} from './webSearch.js'
import {
  contextMessages,
  defaultGeneration,
  defaultConversation,
  requestParameters,
} from './configuration.js'
import { readServerSentEvents } from '../services/api/sse.js'
import { profileContext } from './profile.js'
import { mergeUsage, providerUsage, type RawUsage, type Usage } from './usage.js'
import {
  displayText,
  liveSelection,
  renderSelection,
  tokens,
  textOf,
  type Call,
  type Mcp,
  type Message,
  type State,
  type Turn,
  type Window,
} from './core.js'
import { secret } from './storage.js'
export type Tool = { name: string; description: string; input_schema: Record<string, unknown> }
export type Output = {
  web?: WebResult
  providerContent?: Record<string, unknown>[]
  serverToolCalls?: Record<string, unknown>[]
  providerIdentity?: string
  text: string
  reasoning: string
  calls: Call[]
  usage?: Usage
  thinkingBlocks?: Record<string, unknown>[]
}
const field = (type: string, description: string) => ({ type, description })
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})
export const builtins: Tool[] = [
  {
    name: 'orbis_time',
    description: '只读查询当前设备时间：当地日期时间、IANA时区、UTC与unix_ms。需要最新时间或设定哨兵前可调用。消息上的时间固定为该条发送/开始记录时间；长工具链中请用本工具获取最新时间。',
    input_schema: schema({}),
  },
  {
    name: 'orbis_voice_note',
    description:
      '发送一条可点击播放的真实语音条。text为1–2000字，使用人类配置的TTS和音色。成功返回message_id；不自动播放，不代表人类已听，不要重复发送。需人类开启允许AI发语音条。',
    input_schema: schema({ text: { type: 'string', minLength: 1, maxLength: 2000 } }, ['text']),
  },
  {
    name: 'start_voice_call',
    description:
      '向当前前台窗口发起来电邀请。reason为邀请原因，max_ring_seconds为5–60秒默认30。人类接听后才能开始语音，accepted代表同意，当前回复结束后才开始听说；拒绝/未接后15分钟内不重复呼叫。不会拨打手机号码或后台唤醒。',
    input_schema: schema(
      {
        reason: { type: 'string', minLength: 1, maxLength: 2000 },
        max_ring_seconds: { type: 'integer', minimum: 5, maximum: 60 },
      },
      ['reason']
    ),
  },
  {
    name: 'end_voice_call',
    description: '结束当前轮次绑定的语音通话。call_id可省略；不能结束其他窗口或后来新拨的电话。',
    input_schema: schema({ call_id: { type: 'string' }, reason: { type: 'string' } }),
  },
  {
    name: 'orbis_help',
    description:
      '读取内置 Orbis Web Lite 说明书，供你使用工具或指导人类。topic=overview/chat/memory/context/settings/voice/sentinel/mcp/search/data/tools。无需把完整说明书每轮塞进上下文。',
    input_schema: schema({ topic: { type: 'string' } }),
  },
  {
    name: 'orbis_conversation_settings',
    description:
      '与 Orbis 同名的当前窗口设置工具。inspect 查看；update 修改 text/enabled/world_book_text/world_book_enabled。省略保留，空字符串清空，关闭保留正文。从下轮生效。本工具需人类打开权限，不修改全局主提示词或其他窗口。',
    input_schema: schema(
      {
        action: { type: 'string', enum: ['inspect', 'update'] },
        text: { type: 'string' },
        enabled: { type: 'boolean' },
        world_book_text: { type: 'string' },
        world_book_enabled: { type: 'boolean' },
      },
      ['action']
    ),
  },
  {
    name: 'orbis_reply',
    description:
      '引用当前窗口已有消息：action=quote，target_message_id；引用附于下一条回复。撤回自己的已完成回复：action=retract。不能撤回人类消息或工具过程。',
    input_schema: schema({ action: { type: 'string' }, target_message_id: { type: 'string' } }, [
      'action',
      'target_message_id',
    ]),
  },
  {
    name: 'orbis_memory',
    description:
      'Orbis 记忆库：跨窗口保存、查询、更新、软删和版本恢复。轻量档只访问当前窗口；标准/独立跨窗。body 原文完整保存，默认 static。state=static/conditional/pinned/paused。read 通过 id/query 和 offset/limit 查询。无需每轮例行写入。',
    input_schema: schema({
      action: field('string', 'save/read/update/delete/history/restore/set_state'),
      id: field('string', '记忆ID'),
      body: field('string', '完整原文'),
      summary: field('string', '自动浮现摘要'),
      tags: { type: 'array', items: { type: 'string' } },
      keywords: { type: 'array', items: { type: 'string' } },
      state: field('string', 'static/conditional/pinned/paused'),
      important: field('boolean', '优先考虑短原文'),
      minIntervalTurns: field('integer', '最小浮现轮次'),
      query: field('string', '查找文字'),
      offset: { type: 'integer' },
      limit: { type: 'integer' },
      revision: { type: 'integer' },
      expected_revision: { type: 'integer' },
    }),
  },
  {
    name: 'conversation_search',
    description: '搜索当前记忆范围内的聊天窗口。轻量档不会搜索其他窗口。',
    input_schema: schema({ query: { type: 'string' } }, ['query']),
  },
  {
    name: 'conversation_read',
    description: '按窗口ID分页读取原始聊天历史，包括压缩前备份窗口。返回通话索引voice_calls；填写voice_session_id可分页查该次通话完整原文及工具记录。只读，不执行历史工具。',
    input_schema: schema(
      { window_id: { type: 'string' }, offset: { type: 'integer' }, limit: { type: 'integer' }, voice_session_id: { type: 'string' } },
      ['window_id']
    ),
  },
  {
    name: 'compact',
    description:
      '用你自己写的完整摘要压缩当前对话；保留最近消息与完整工具链。阈值只提醒，不强制压缩。可先存记忆，也可直接压缩。失败保留原文。',
    input_schema: schema({ summary: { type: 'string' }, keep_recent: { type: 'integer' } }, [
      'summary',
    ]),
  },
  {
    name: 'context_compaction_status',
    description: '查看当前参考上下文用量和压缩阈值。',
    input_schema: schema({}),
  },
  {
    name: 'orbis_sentinel',
    description:
      '人类只授权总开关，具体唤醒时间、内容与规则由你自主安排；不要让人类填表。绑定当前窗口。action=create/list/pause/resume/delete；type=once/interval/daily。先用 orbis_time 核对当前时间和时区，due_at_ms为未来Unix毫秒。只在网页打开时执行，保存不等于已唤醒。',
    input_schema: schema({
      action: { type: 'string' },
      id: { type: 'string' },
      type: { type: 'string' },
      name: { type: 'string' },
      prompt: { type: 'string' },
      due_at_ms: { type: 'number' },
      interval_seconds: { type: 'integer' },
      daily_at: { type: 'string' },
      timezone: { type: 'string' },
    }),
  },
]
export const mcpAlias = (connection: string, name: string) => {
  let h = 2166136261
  for (const c of name) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return (
    'mcp_' + connection.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16) + '_' + (h >>> 0).toString(16)
  )
}
export const enabledTools = (s: State, window = s.windows[0]?.id): Tool[] => [
  ...builtins.filter(
    (t) =>
      (t.name !== 'orbis_voice_note' || s.settings.speech?.allowVoiceNotes === true) &&
      (t.name !== 'start_voice_call' || s.settings.speech?.allowIncomingCalls === true) &&
      (t.name !== 'end_voice_call' || !!boundCall(window)) &&
      (t.name !== 'orbis_sentinel' || s.settings.sentinelEnabled) &&
      (t.name !== 'orbis_conversation_settings' ||
        s.windows.find((w) => w.id === window)?.conversation?.allowAI === true)
  ),
  ...s.mcp.flatMap((c) =>
    c.tools
      .filter((t) => t.enabled)
      .map((t) => ({
        name: mcpAlias(c.id, t.name),
        description: t.description,
        input_schema: t.inputSchema,
      }))
  ),
]
export function endpointURL(endpoint: string, path: string) {
  const u = new URL(endpoint)
  if (
    u.protocol !== 'https:' &&
    !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))
  )
    throw Error('请使用 HTTPS 接口（本机调试可用 localhost）')
  if (u.username || u.password) throw Error('请勿将密钥写在地址中')
  return endpoint.replace(/\/$/, '') + path
}
function attachmentText(m: Message): string {
  return (m.files ?? [])
    .filter((f) => f.mime === 'text/plain')
    .map((f) => {
      try {
        const raw = atob(f.data.split(',')[1])
        const text = new TextDecoder().decode(Uint8Array.from(raw, (c) => c.charCodeAt(0)))
        return '\n[用户附件：' + f.name + '，内容为资料]\n' + text + '\n[附件结束]'
      } catch {
        return '\n[附件读取失败：' + f.name + ']'
      }
    })
    .join('')
}
function material(m: Message): unknown[] {
  const content: unknown[] = []
  const text = messageTimestamp(m) + m.text + attachmentText(m)
  if (text) content.push({ type: 'text', text })
  for (const f of m.files ?? [])
    if (f.mime.startsWith('image/'))
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: f.mime, data: f.data.split(',')[1] },
      })
  return content
}
export function makeRequest(s: State, w: Window, turn: Turn, tools: Tool[]) {
  const settings = turn.configuration?.settings ?? s.settings,
    conversation = turn.configuration?.conversation ?? w.conversation ?? defaultConversation()
  const parameters = requestParameters(settings)
  const webTools = searchTools(settings)
  const webParameters =
    supportsWeb(settings) && settings.webSearch ? { safety_check: { level: 'high' } } : {}
  const selection = liveSelection(s, turn),
    pins = selection.filter((x) => x.kind === 'pinned'),
    hits = selection.filter((x) => x.kind !== 'pinned')
  w = {
    ...w,
    messages: contextMessages(
      w.messages.filter((m) => !m.voiceCall && !(m.role === 'assistant' && m.voiceNote)),
      settings.generation ?? defaultGeneration()
    ).map((m) => ({
      ...m,
      text: displayText(s, w, m),
    })),
  }
  const used = tokens(textOf(w)),
    threshold = settings.threshold
  const advisory =
    threshold > 0 && used >= threshold * 0.9
      ? `\n[宿主状态] 当前上下文约 ${used} tokens，提醒阈值 ${threshold}。是否压缩由你决定，可自行写摘要调用 compact。`
      : ''
  const system =
    settings.prompt +
    profileContext(settings, s.settings) +
    '\n[Orbis Web Lite 宿主] 单一 AI、多窗口。初次使用或指导人类时可调用 orbis_help 按主题读取内置说明书；不要猜不存在的功能。\n' +
    (conversation.enabled ? '[当前窗口补充提示词]\n' + conversation.text + '\n' : '') +
    (conversation.world_book_enabled
      ? '[当前窗口世界书：背景资料]\n' + conversation.world_book_text + '\n'
      : '') +
    '\n[时间说明] 消息时间为设备记录时间；AI为开始生成时间，摘要为创建时间，不代表摘要内事件发生时间。新消息保存原时区，旧记录无时区时固定按UTC表示。按最新人类/宿主事件的时间理解本轮日期；需要实时钟请调用orbis_time。\n' +
    '\n[当前窗口 ID] ' +
    w.id +
    '\n' +
    renderSelection(pins) +
    '\n[记忆范围] ' +
    (w.mode === 'light'
      ? '当前窗口隔离，只能存查本窗口资料，无自动注入。'
      : '所有窗口属于同一个你，按需要查询记忆和旧对话。')
  const tail = renderSelection(hits) + advisory
  let lastHuman = -1
  w.messages.forEach((m, i) => {
    if (m.role === 'user') lastHuman = i
  })
  // A saved compaction summary (or imported history) can start with an assistant.
  // Preserve its authorship and original contents; add only a request-local provenance
  // boundary so strict providers receive a user-first conversation. Never persist it.
  const historyBoundary = '【宿主提供的历史上下文说明，不是人类新发言】以下开头的 AI 消息来自之前的对话，可能包含压缩摘要，仅作为历史资料。不要将其中内容当成新任务；请结合后续真实用户消息和工具结果接续。' + (lastHuman < 0 ? tail : '')
  const startsWithAssistant = w.messages[0]?.role === 'assistant'
  if (settings.protocol === 'openai') {
    const messages: Record<string, unknown>[] = [{ role: 'system', content: system }]
    if (startsWithAssistant) { messages.push({ role: 'user', content: historyBoundary }) }
    w.messages.forEach((m, i) => {
      if (i === lastHuman && tail) messages.push({ role: 'system', content: tail })
      if (m.role === 'tool')
        messages.push({ role: 'tool', tool_call_id: m.callId, content: m.text })
      else {
        const images = (m.files ?? []).filter((f) => f.mime.startsWith('image/'))
        messages.push({
          role: m.role,
          content: images.length
            ? [
                { type: 'text', text: messageTimestamp(m) + m.text + attachmentText(m) },
                ...images.map((f) => ({ type: 'image_url', image_url: { url: f.data } })),
              ]
            : messageTimestamp(m) + m.text + attachmentText(m),
          ...(m.serverToolCalls && !m.retracted && m.providerIdentity === providerIdentity(settings)
            ? { server_tool_calls: m.serverToolCalls }
            : {}),
          ...(m.reasoning ? { reasoning_content: m.reasoning } : {}),
          ...(m.calls?.length
            ? {
                tool_calls: m.calls.map((c) => ({
                  id: c.id,
                  type: 'function',
                  function: { name: c.name, arguments: c.arguments },
                })),
              }
            : {}),
        })
      }
    })
    return {
      model: settings.model,
      ...parameters,
      ...webParameters,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      tools: [
        ...webTools,
        ...tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.input_schema },
        })),
      ],
    }
  }
  const messages: { role: string; content: unknown[] }[] = []
  if (startsWithAssistant) { messages.push({ role: 'user', content: [{ type: 'text', text: historyBoundary }] }) }
  for (const [i, m] of w.messages.entries()) {
    const role = m.role === 'tool' ? 'user' : m.role
    const content =
      m.role === 'tool'
        ? [{ type: 'tool_result', tool_use_id: m.callId, content: m.text }]
        : m.providerContent?.length &&
            !m.retracted &&
            !m.quoteId &&
            m.providerIdentity === providerIdentity(settings)
          ? structuredClone(m.providerContent)
          : [
              ...(m.thinkingBlocks ?? []),
              ...material(m),
              ...(m.calls ?? []).map((c) => ({
                type: 'tool_use',
                id: c.id,
                name: c.name,
                input: JSON.parse(c.arguments || '{}'),
              })),
            ]
    if (m.role !== 'tool' && m.providerContent?.length && !m.retracted && !m.quoteId && m.providerIdentity === providerIdentity(settings)) {
      // Keep signed blocks and original server tool sequence intact.
      let index = 0
      while (index < content.length && ['thinking', 'redacted_thinking'].includes(String((content[index] as Record<string, unknown>).type))) index++
      content.splice(index, 0, { type: 'text', text: messageTimestamp(m) })
    }
    if (i === lastHuman && tail) content.push({ type: 'text', text: tail })
    if (!content.length) continue
    if (messages.at(-1)?.role === role) messages[messages.length - 1].content.push(...content)
    else messages.push({ role, content })
  }
  return {
    model: settings.model,
    ...parameters,
    ...webParameters,
    system,
    messages,
    stream: true,
    tools: [...webTools, ...tools],
  }
}
export async function streamModel(
  s: State,
  w: Window,
  turn: Turn,
  tools: Tool[],
  signal: AbortSignal,
  onOutput: (o: Output) => void
): Promise<Output> {
  const settings = turn.configuration?.settings ?? s.settings
  const key = secret('api')
  if (!key) throw Error('先在连接设置填写 API Key')
  const base =
    new URL(settings.endpoint).hostname === 'api.deepseek.com'
      ? settings.endpoint.replace(/\/$/, '').replace(/\/(?:anthropic\/)?v1$/, '')
      : settings.endpoint.replace(/\/$/, '')
  const path =
    settings.protocol === 'openai'
      ? base.endsWith('/v1')
        ? '/chat/completions'
        : '/v1/chat/completions'
      : new URL(base).hostname === 'api.deepseek.com' && !base.endsWith('/anthropic')
        ? '/anthropic/v1/messages'
        : base.endsWith('/v1')
          ? '/messages'
          : '/v1/messages'
  const res = await fetch(endpointURL(base, path), {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      ...(settings.protocol === 'messages'
        ? {
            'anthropic-version': '2023-06-01',
            'x-api-key': key,
            'anthropic-dangerous-direct-browser-access': 'true',
          }
        : {}),
    },
    body: JSON.stringify(makeRequest(s, w, turn, tools)),
    signal,
  })
  if (!res.ok) throw Error(`接口 ${res.status}：${(await res.text()).slice(0, 600)}`)
  if (!res.body || !res.headers.get('content-type')?.includes('text/event-stream'))
    throw Error('接口没有返回 SSE 流，请核对协议与地址')
  const out: Output = { text: '', reasoning: '', calls: [], thinkingBlocks: [] },
    calls = new Map<number, Call>(),
    thinking = new Map<number, Record<string, unknown>>()
  const blocks = new Map<number, Record<string, any>>()
  const web = emptyWeb()
  let complete = false
  let usage: RawUsage = {}
  for await (const event of readServerSentEvents(res.body, signal)) {
    if (event.data === '[DONE]') {
      complete = true
      break
    }
    const e = JSON.parse(event.data)
    if (e.error || e.type === 'error') throw Error(e.error?.message ?? '服务端流错误')
    if (settings.protocol === 'openai') {
      const c = e.choices?.[0]
      if (e.usage) usage = mergeUsage(usage, e.usage)
      if (c?.delta?.content) out.text += c.delta.content
      if (c?.server_tool_event?.call) applyOpenAIWeb(web, c.server_tool_event.call)
      if (Array.isArray(c?.delta?.server_tool_calls)) {
        out.serverToolCalls = c.delta.server_tool_calls
        for (const step of c.delta.server_tool_calls)
          for (const call of step.calls ?? []) applyOpenAIWeb(web, call)
      }
      for (const citation of c?.delta?.annotations ?? []) applyCitation(web, citation)
      if (c?.delta?.reasoning_content) out.reasoning += c.delta.reasoning_content
      for (const tc of c?.delta?.tool_calls ?? []) {
        const call = calls.get(tc.index) ?? { id: '', name: '', arguments: '' }
        call.id = tc.id ?? call.id
        call.name += tc.function?.name ?? ''
        call.arguments += tc.function?.arguments ?? ''
        calls.set(tc.index, call)
      }
      if (c?.finish_reason) complete = true
    } else {
      if (e.type === 'content_block_start') {
        const block = e.content_block ?? {}
        blocks.set(e.index, structuredClone(block))
        applyWebBlock(web, block)
        for (const citation of block.citations ?? []) applyCitation(web, citation)
        if (block.type === 'text') out.text += block.text ?? ''
      }
      if (e.type === 'content_block_delta') {
        const block = blocks.get(e.index)
        if (block) {
          if (e.delta?.text) block.text = String(block.text ?? '') + e.delta.text
          if (e.delta?.thinking) block.thinking = String(block.thinking ?? '') + e.delta.thinking
          if (e.delta?.signature)
            block.signature = String(block.signature ?? '') + e.delta.signature
          if (e.delta?.citation) {
            block.citations = [...(block.citations ?? []), e.delta.citation]
            applyCitation(web, e.delta.citation)
          }
        }
      }
      if (
        e.type === 'content_block_start' &&
        ['thinking', 'redacted_thinking'].includes(e.content_block?.type)
      )
        thinking.set(e.index, { ...e.content_block })
      if (e.type === 'content_block_delta' && thinking.has(e.index)) {
        const block = thinking.get(e.index)!
        if (e.delta?.thinking) block.thinking = String(block.thinking ?? '') + e.delta.thinking
        if (e.delta?.signature) block.signature = String(block.signature ?? '') + e.delta.signature
      }
      if (e.type === 'content_block_start' && e.content_block?.type === 'tool_use')
        calls.set(e.index, {
          id: e.content_block.id,
          name: e.content_block.name,
          arguments: Object.keys(e.content_block.input ?? {}).length
            ? JSON.stringify(e.content_block.input)
            : '',
        })
      if (e.type === 'content_block_delta') {
        if (e.delta?.text) out.text += e.delta.text
        if (e.delta?.thinking) out.reasoning += e.delta.thinking
        if (e.delta?.partial_json !== undefined) {
          const call = calls.get(e.index)
          if (call) call.arguments += e.delta.partial_json
        }
      }
      if (e.type === 'message_start') usage = mergeUsage(usage, e.message?.usage)
      if (e.type === 'message_delta') usage = mergeUsage(usage, e.usage)
      if (e.type === 'message_stop') complete = true
    }
    out.calls = [...calls.values()]
    out.web = web.calls.length || web.citations.length ? structuredClone(web) : undefined
    out.providerIdentity = providerIdentity(settings)
    out.usage = providerUsage(usage, settings.protocol)
    out.thinkingBlocks = [...thinking.values()]
    onOutput({ ...out, calls: [...out.calls] })
  }
  if (signal.aborted) throw new DOMException('已停止', 'AbortError')
  if (!complete) throw Error('回复流提前中断；未执行不完整工具调用')
  for (const c of out.calls) {
    if (!c.id || !c.name) throw Error('工具调用缺少标识')
    JSON.parse(c.arguments || '{}')
  }
  finishWeb(web)
  out.web = web.calls.length || web.citations.length ? web : undefined
  if (settings.protocol === 'messages' && out.web) {
    for (const [index, call] of calls) {
      const block = blocks.get(index)
      if (block) block.input = JSON.parse(call.arguments || '{}')
    }
    out.providerContent = [...blocks.values()]
  }
  return out
}
const sessions = new Map<string, string>()
async function rpc(
  c: Mcp,
  method: string,
  params: unknown,
  signal?: AbortSignal,
  notification = false
): Promise<unknown> {
  const key = secret('mcp:' + c.id),
    sid = sessions.get(c.id),
    id = crypto.randomUUID()
  const r = await fetch(endpointURL(c.url, ''), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(key ? { Authorization: 'Bearer ' + key } : {}),
      ...(sid ? { 'Mcp-Session-Id': sid, 'MCP-Protocol-Version': '2025-03-26' } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, params }),
    signal,
  })
  if (!r.ok) throw Error(`MCP ${r.status}：${(await r.text()).slice(0, 400)}`)
  const next = r.headers.get('Mcp-Session-Id')
  if (next) sessions.set(c.id, next)
  if (notification || r.status === 202) return null
  let value
  if (r.headers.get('content-type')?.includes('text/event-stream')) {
    if (!r.body) throw Error('MCP 空响应')
    for await (const e of readServerSentEvents(r.body, signal ?? new AbortController().signal)) {
      const v = JSON.parse(e.data)
      if (v.id === id) {
        value = v
        break
      }
    }
  } else value = await r.json()
  if (!value || value.id !== id) throw Error('MCP 响应 ID 不匹配')
  if (value.error) throw Error(value.error.message ?? 'MCP 错误')
  return value.result
}
export async function connectMcp(c: Mcp, signal?: AbortSignal) {
  await rpc(
    c,
    'initialize',
    {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'Orbis Web Lite', version: '0.1.0' },
    },
    signal
  )
  await rpc(c, 'notifications/initialized', {}, signal, true)
  let cursor: string | undefined
  const list: Mcp['tools'] = []
  do {
    const result = (await rpc(c, 'tools/list', cursor ? { cursor } : {}, signal)) as {
      tools: Mcp['tools']
      nextCursor?: string
    }
    if (!Array.isArray(result.tools)) throw Error('没有工具目录')
    list.push(...result.tools.map((t) => ({ ...t, enabled: false })))
    cursor = result.nextCursor
    if (list.length > 1000) throw Error('工具目录过大')
  } while (cursor)
  return list
}
export async function callMcp(c: Mcp, name: string, args: unknown, signal: AbortSignal) {
  if (!sessions.has(c.id)) await connectMcp(c, signal)
  return rpc(c, 'tools/call', { name, arguments: args }, signal)
}
