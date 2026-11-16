/** Strict JSON parsing for imports: duplicate keys must not silently discard a branch. */
export function importJson(text: string): unknown {
  let p = 0
  const fail = (): never => {
    throw Error('导出包 JSON 损坏、键重复或结构过深；当前会话未导入')
  }
  const space = () => {
    while (p < text.length && /[\x20\t\r\n]/.test(text[p])) {
      p++
    }
  }
  const string = () => {
    const start = p++
    let escaped = false
    while (p < text.length) {
      const c = text[p++]
      if (!escaped && c === '"') {
        try {
          return JSON.parse(text.slice(start, p)) as string
        } catch {
          return fail()
        }
      }
      if (!escaped && c === '\\') {
        escaped = true
      } else {
        escaped = false
      }
    }
    return fail()
  }
  const value = (depth: number): unknown => {
    if (depth > 256) {
      return fail()
    }
    space()
    const c = text[p]
    if (c === '"') {
      return string()
    }
    if (c === '{') {
      p++
      space()
      const result = Object.create(null) as Record<string, unknown>
      if (text[p] === '}') {
        p++
        return result
      }
      while (p < text.length) {
        space()
        if (text[p] !== '"') {
          return fail()
        }
        const key = string()
        space()
        if (Object.hasOwn(result, key) || text[p++] !== ':') {
          return fail()
        }
        result[key] = value(depth + 1)
        space()
        const next = text[p++]
        if (next === '}') {
          return result
        }
        if (next !== ',') {
          return fail()
        }
      }
      return fail()
    }
    if (c === '[') {
      p++
      space()
      const result: unknown[] = []
      if (text[p] === ']') {
        p++
        return result
      }
      while (p < text.length) {
        result.push(value(depth + 1))
        space()
        const next = text[p++]
        if (next === ']') {
          return result
        }
        if (next !== ',') {
          return fail()
        }
      }
      return fail()
    }
    for (const [word, result] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (text.startsWith(word, p)) {
        p += word.length
        return result
      }
    }
    const number = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y
    number.lastIndex = p
    const match = number.exec(text)
    if (match) {
      p = number.lastIndex
      const n = Number(match[0])
      if (Number.isFinite(n)) {
        return n
      }
    }
    return fail()
  }
  const result = value(0)
  space()
  if (p !== text.length) {
    return fail()
  }
  return result
}

/** Incrementally split a legacy conversations array. Only one conversation is materialized. */
export class JsonObjectArrayStream {
  private state: 'start' | 'value' | 'nextValue' | 'item' | 'comma' | 'done' = 'start'
  private depth = 0
  private quoted = false
  private escaped = false
  private parts: string[] = []
  private length = 0
  constructor(private accept: (value: unknown) => void) {}
  push(text: string) {
    let start = this.state === 'item' ? 0 : -1
    const fail = (): never => {
      throw Error('DeepSeek 会话列表格式损坏；尚未写入聊天')
    }
    for (let p = 0; p < text.length; p++) {
      const c = text[p]
      if (this.state === 'item') {
        if (this.quoted) {
          if (this.escaped) {
            this.escaped = false
          } else if (c === '\\') {
            this.escaped = true
          } else if (c === '"') {
            this.quoted = false
          }
        } else if (c === '"') {
          this.quoted = true
        } else if (c === '{' || c === '[') {
          this.depth++
        } else if (c === '}' || c === ']') {
          this.depth--
        }
        if (this.depth === 0) {
          this.add(text.slice(start, p + 1))
          this.accept(importJson(this.parts.join('')))
          this.parts = []
          this.length = 0
          start = -1
          this.state = 'comma'
        }
        continue
      }
      if (/[\x20\t\r\n]/.test(c)) {
        continue
      }
      if (this.state === 'start' && c === '[') {
        this.state = 'value'
      } else if (this.state === 'value' && c === ']') {
        this.state = 'done'
      } else if ((this.state === 'value' || this.state === 'nextValue') && c === '{') {
        this.state = 'item'
        this.depth = 1
        start = p
      } else if (this.state === 'comma' && c === ',') {
        this.state = 'nextValue'
      } else if (this.state === 'comma' && c === ']') {
        this.state = 'done'
      } else {
        fail()
      }
    }
    if (start >= 0) {
      this.add(text.slice(start))
    }
  }
  private add(text: string) {
    this.length += text.length
    if (this.length > 64 * 1024 * 1024) {
      throw Error('单个会话超过浏览器安全解析范围，请拆分该会话；原文未截断')
    }
    this.parts.push(text)
  }
  finish() {
    if (this.state !== 'done') {
      throw Error('DeepSeek 会话列表未完整结束；尚未写入聊天')
    }
  }
}
