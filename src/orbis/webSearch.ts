import type { Message, State } from './core.js'
export type WebSource = { url: string; title: string; snippet?: string; site?: string }
export type WebCall = {
  id: string
  action: string
  queries: string[]
  url?: string
  status: 'working' | 'done' | 'error'
  sources: WebSource[]
  error?: string
}
export type WebResult = { calls: WebCall[]; citations: WebSource[] }
export const emptyWeb = (): WebResult => ({ calls: [], citations: [] })
export function safeWebURL(value: unknown): string | undefined {
  if (typeof value !== 'string') return
  try {
    const u = new URL(value)
    if (['https:', 'http:'].includes(u.protocol) && !u.username && !u.password) return u.href
  } catch {}
  return undefined
}
export function supportsWeb(s: State['settings']) {
  try {
    return new URL(s.endpoint).hostname === 'api.deepseek.com' && s.model === 'deepseek-flash'
  } catch {
    return false
  }
}
export const providerIdentity = (s: State['settings']) =>
  `${s.protocol}|${s.endpoint.replace(/\/$/, '')}|${s.model}`
export function searchTools(s: State['settings']): Record<string, unknown>[] {
  if (!s.webSearch) return []
  if (!supportsWeb(s))
    throw Error(
      '智能搜索目前接入 DeepSeek 官方 deepseek-flash；请在连接设置选择该模型。不会自动替换模型或密钥。'
    )
  return ['deepseek_web_search', 'deepseek_read_url'].map((name) =>
    s.protocol === 'messages' ? { type: name, name } : { type: name }
  )
}
const source = (v: any): WebSource | undefined => {
  const url = safeWebURL(v?.url)
  return url
    ? {
        url,
        title: typeof v.title === 'string' && v.title ? v.title : new URL(url).hostname,
        ...(typeof v.snippet === 'string' ? { snippet: v.snippet } : {}),
        ...(typeof v.site_name === 'string' ? { site: v.site_name } : {}),
      }
    : undefined
}
const unique = (sources: (WebSource | undefined)[]) => [
  ...new Map(sources.filter(Boolean).map((s) => [s!.url, s!])).values(),
]
export function applyWebBlock(web: WebResult, block: any) {
  if (block.type === 'server_tool_use') {
    if (
      !['deepseek_web_search', 'deepseek_read_url'].includes(block.name) ||
      typeof block.id !== 'string'
    )
      return
    web.calls.push({
      id: block.id,
      action: block.input?.action ?? 'search',
      queries: Array.isArray(block.input?.queries)
        ? block.input.queries.filter((x: unknown) => typeof x === 'string')
        : [],
      url: safeWebURL(block.input?.url),
      status: 'working',
      sources: [],
    })
  } else if (['web_search_tool_result', 'web_fetch_tool_result'].includes(block.type)) {
    let call = web.calls.find((c) => c.id === block.tool_use_id)
    if (!call) {
      call = {
        id: String(block.tool_use_id),
        action: 'search',
        queries: [],
        status: 'working',
        sources: [],
      }
      web.calls.push(call)
    }
    const rows = Array.isArray(block.content) ? block.content : [block.content]
    const error = rows.find((x: any) => x?.error_code)
    call.status = error ? 'error' : 'done'
    call.error = error?.error_code
    call.sources = unique(
      rows.map((x: any) =>
        source(x?.type === 'web_fetch_result' ? { url: x.url, title: x.content?.title } : x)
      )
    )
  }
}
export function applyCitation(web: WebResult, citation: any) {
  web.citations = unique([...web.citations, source(citation?.url_citation ?? citation)])
}
export function applyOpenAIWeb(web: WebResult, call: any) {
  if (!call || typeof call.id !== 'string') return
  const index = web.calls.findIndex((c) => c.id === call.id)
  const prior = web.calls[index]
  const next: WebCall = {
    id: call.id,
    action: call.action?.type ?? prior?.action ?? 'search',
    queries: Array.isArray(call.action?.queries)
      ? call.action.queries.filter((x: unknown) => typeof x === 'string')
      : (prior?.queries ?? []),
    url: safeWebURL(call.action?.url) ?? prior?.url,
    status: call.status === 'failed' ? 'error' : call.status === 'completed' ? 'done' : 'working',
    sources: unique([
      ...(prior?.sources ?? []),
      ...(Array.isArray(call.sources) ? call.sources.map(source) : []),
      source(call.page),
    ]),
    error: call.error?.code,
  }
  if (index < 0) web.calls.push(next)
  else web.calls[index] = next
}
export function finishWeb(web: WebResult) {
  for (const call of web.calls)
    if (call.status === 'working') {
      call.status = 'error'
      call.error = '未收到完整搜索结果'
    }
}
export const webSources = (m: Message) =>
  unique(
    [...(m.web?.citations ?? []), ...(m.web?.calls.flatMap((c) => c.sources) ?? [])].map(source)
  )
