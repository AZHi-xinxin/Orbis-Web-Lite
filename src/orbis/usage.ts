/** Provider counters, never a local estimate. Each stream owns a fresh snapshot. */
export type Usage = { input?: number; output?: number; cached?: number }
export type RawUsage = Record<string, unknown>
const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
export function mergeUsage(previous: RawUsage, incoming: unknown): RawUsage {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return previous
  return { ...previous, ...incoming }
}
export function providerUsage(raw: RawUsage, protocol: 'openai' | 'messages'): Usage | undefined {
  const cached = protocol === 'messages'
    ? count(raw.cache_read_input_tokens)
    : count(raw.prompt_cache_hit_tokens) ?? count((raw.prompt_tokens_details as RawUsage | undefined)?.cached_tokens)
  const input = protocol === 'messages'
    ? count(raw.input_tokens) === undefined ? undefined
      : count(raw.input_tokens)! + (cached ?? 0) + (count(raw.cache_creation_input_tokens) ?? 0)
    : count(raw.prompt_tokens)
  const output = count(protocol === 'messages' ? raw.output_tokens : raw.completion_tokens)
  if (input === undefined && output === undefined && cached === undefined) return undefined
  return { input, output, cached: input !== undefined && cached !== undefined && cached > input ? undefined : cached }
}
