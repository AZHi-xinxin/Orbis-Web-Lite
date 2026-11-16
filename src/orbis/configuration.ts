import type { Message, State, Window } from './core.js'
export type ConversationSettings = {
  text: string
  enabled: boolean
  world_book_text: string
  world_book_enabled: boolean
  allowAI: boolean
}
export type GenerationOptions = {
  temperature: number | null
  topP: number | null
  maxTokens: number
  contextTurns: number
  contextTokens: number
  reasoning: 'auto' | 'off' | 'low' | 'medium' | 'high' | 'max'
}
export const defaultConversation = (): ConversationSettings => ({
  text: '',
  enabled: true,
  world_book_text: '',
  world_book_enabled: true,
  allowAI: false,
})
export const defaultGeneration = (): GenerationOptions => ({
  temperature: null,
  topP: null,
  maxTokens: 8192,
  contextTurns: 0,
  contextTokens: 0,
  reasoning: 'auto',
})
export function conversationSettings(w: Window, args: Record<string, unknown>) {
  const c = w.conversation ?? defaultConversation()
  if (!c.allowAI) throw Error('人类尚未允许 AI 修改当前窗口的提示词和世界书')
  if (
    Object.keys(args).some(
      (k) => !['action', 'text', 'enabled', 'world_book_text', 'world_book_enabled'].includes(k)
    )
  )
    throw Error('仅支持当前窗口的提示词、世界书及开关')
  if (args.action === 'inspect') {
    if (Object.keys(args).length !== 1) throw Error('inspect 不修改字段')
  } else if (args.action === 'update') {
    if (Object.keys(args).length < 2) throw Error('请提供要修改的字段')
    const next = { ...c }
    for (const k of ['text', 'world_book_text'] as const)
      if (k in args) {
        if (typeof args[k] !== 'string' || new TextEncoder().encode(args[k]).length > 524288)
          throw Error(k + ' 需为不超过 512 KiB 的文本')
        next[k] = args[k]
      }
    for (const k of ['enabled', 'world_book_enabled'] as const)
      if (k in args) {
        if (typeof args[k] !== 'boolean') throw Error(k + ' 必须是布尔值')
        next[k] = args[k]
      }
    w.conversation = next
  } else throw Error('action 需为 inspect 或 update')
  const { allowAI: _, ...value } = w.conversation ?? c
  return {
    status: args.action === 'update' ? 'saved' : 'ok',
    scope: 'current_conversation',
    effective_from: 'next_turn',
    ...value,
  }
}
export function isDeepSeek(endpoint: string) {
  try {
    return new URL(endpoint).hostname === 'api.deepseek.com'
  } catch {
    return false
  }
}
export function parameterWarnings(s: State['settings']): string[] {
  const g = s.generation ?? defaultGeneration(),
    result: string[] = []
  if (isDeepSeek(s.endpoint)) {
    if (g.reasoning !== 'off' && g.temperature !== null)
      result.push('DeepSeek 思考模式不使用温度，此时不会发送该值。')
    if (g.topP !== null && s.model === 'deepseek-flash')
      result.push(
        g.reasoning === 'off'
          ? 'DeepSeek Flash 非思考模式固定 Top-P=1，自定义值不发送。'
          : g.topP < 0.95
            ? 'DeepSeek Flash 思考模式 Top-P 最低 0.95，此值将按 0.95 发送。'
            : ''
      )
    if (g.topP !== null && s.model === 'deepseek-v4-pro' && g.reasoning !== 'off')
      result.push('DeepSeek V4 Pro 思考模式使用模型固定 Top-P，自定义值不发送。')
  } else if (s.protocol === 'messages' && g.reasoning !== 'auto')
    result.push(
      '此 Messages 服务的思考参数尚未适配，请将思考等级设为“模型默认”；不会发送不确定的参数。'
    )
  else if (g.reasoning !== 'auto')
    result.push(
      '通用 Chat Completions 会发送 reasoning_effort；需服务商支持所选等级，不支持时请选“模型默认”。'
    )
  return result.filter(Boolean)
}
export function requestParameters(s: State['settings']) {
  const g = s.generation ?? defaultGeneration(),
    p: Record<string, unknown> = {},
    deep = isDeepSeek(s.endpoint),
    thinking = g.reasoning !== 'off'
  if (g.temperature !== null) {
    if (!Number.isFinite(g.temperature) || g.temperature < 0 || g.temperature > 2)
      throw Error('温度范围为 0–2')
    if (!(deep && thinking)) p.temperature = g.temperature
  }
  if (g.topP !== null) {
    if (!Number.isFinite(g.topP) || g.topP < 0 || g.topP > 1) throw Error('Top-P 范围为 0–1')
    if (
      !(
        deep &&
        ((s.model === 'deepseek-flash' && !thinking) || (s.model === 'deepseek-v4-pro' && thinking))
      )
    )
      p.top_p = deep && s.model === 'deepseek-flash' ? Math.max(0.95, g.topP) : g.topP
  }
  if (!Number.isInteger(g.maxTokens) || g.maxTokens < 1 || g.maxTokens > 131072)
    throw Error('最大输出需为 1–131072 的整数，实际仍受模型容量限制')
  p.max_tokens = g.maxTokens
  if (deep && g.reasoning !== 'auto') {
    p.thinking = { type: thinking ? 'enabled' : 'disabled' }
    if (thinking) {
      const effort = g.reasoning === 'medium' ? 'high' : g.reasoning
      if (s.protocol === 'messages') p.output_config = { effort }
      else p.reasoning_effort = effort
    }
  } else if (!deep && s.protocol === 'openai' && g.reasoning !== 'auto')
    p.reasoning_effort = g.reasoning === 'off' ? 'none' : g.reasoning
  else if (!deep && s.protocol === 'messages' && g.reasoning !== 'auto')
    throw Error(parameterWarnings(s).join(' '))
  return p
}
/** Crop complete turns only; never orphan tool results or delete stored history. Latest turn always survives. */
export function contextMessages(messages: Message[], g: GenerationOptions): Message[] {
  if (
    !Number.isInteger(g.contextTurns) ||
    g.contextTurns < 0 ||
    !Number.isInteger(g.contextTokens) ||
    g.contextTokens < 0
  )
    throw Error('上下文截取需填写非负整数')
  const groups: Message[][] = []
  for (const m of messages) {
    if (groups.at(-1)?.[0].turn === m.turn) groups[groups.length - 1].push(m)
    else groups.push([m])
  }
  const chosen: Message[][] = []
  let used = 0
  for (const group of groups.slice().reverse()) {
    const estimate = Math.ceil(
      Array.from(
        group
          .map(
            (m) => m.text + (m.reasoning ?? '') + (m.thought ?? '') + JSON.stringify(m.calls ?? [])
          )
          .join('\n')
      ).reduce((n, c) => n + (/[^\u0000-\u007f]/.test(c) ? 1 : 0.3), 0)
    )
    if (
      chosen.length &&
      ((g.contextTurns > 0 && chosen.length >= g.contextTurns) ||
        (g.contextTokens > 0 && used + estimate > g.contextTokens))
    )
      break
    chosen.unshift(group)
    used += estimate
  }
  return chosen.flat()
}
