/** Same cased BERT WordPiece and 180/30 slices as Android Orbis. */
export function wordpiece(vocabulary: string[]) {
  const vocab = new Map(vocabulary.map((word, i) => [word, i]))
  const unknown = vocab.get('[UNK]')!,
    cls = vocab.get('[CLS]')!,
    sep = vocab.get('[SEP]')!
  if ([unknown, cls, sep].some((x) => x === undefined)) throw Error('词表缺少必要标记')
  return (text: string, maxTokens = 256): number[] => {
    const basic: string[] = [],
      word: string[] = []
    const flush = () => {
      if (word.length) {
        basic.push(word.join(''))
        word.length = 0
      }
    }
    for (const ch of text) {
      const cp = ch.codePointAt(0)!
      if (cp === 0 || cp === 0xfffd) continue
      if (cp === 9 || cp === 10 || cp === 13 || /\p{Zs}/u.test(ch)) {
        flush()
        continue
      }
      if (/[\p{Cc}\p{Cf}]/u.test(ch)) continue
      const chinese = [
        [0x4e00, 0x9fff],
        [0x3400, 0x4dbf],
        [0x20000, 0x2a6df],
        [0x2a700, 0x2b73f],
        [0x2b740, 0x2b81f],
        [0x2b820, 0x2ceaf],
        [0xf900, 0xfaff],
        [0x2f800, 0x2fa1f],
      ].some(([a, b]) => cp >= a && cp <= b)
      if (/\s/u.test(ch)) {
        flush()
      } else if (
        chinese ||
        /\p{P}/u.test(ch) ||
        (cp >= 33 && cp <= 47) ||
        (cp >= 58 && cp <= 64) ||
        (cp >= 91 && cp <= 96) ||
        (cp >= 123 && cp <= 126)
      ) {
        flush()
        basic.push(ch)
      } else word.push(ch)
    }
    flush()
    const ids = [cls]
    for (const token of basic) {
      const points = Array.from(token),
        pieces: number[] = []
      let start = 0
      if (points.length > 100) pieces.push(unknown)
      else
        while (start < points.length) {
          let end = points.length,
            found: number | undefined
          while (end > start) {
            found = vocab.get((start ? '##' : '') + points.slice(start, end).join(''))
            if (found !== undefined) break
            end--
          }
          if (found === undefined) {
            pieces.length = 0
            pieces.push(unknown)
            break
          }
          pieces.push(found)
          start = end
        }
      for (const p of pieces) {
        if (ids.length === maxTokens - 1) return [...ids, sep]
        ids.push(p)
      }
    }
    return [...ids, sep]
  }
}
export function slices(text: string) {
  const points = Array.from(text),
    result: string[] = []
  for (let i = 0; i < points.length; i += 150) {
    const part = points.slice(i, i + 180).join('')
    if (part.trim()) result.push(part)
    if (i + 180 >= points.length) break
  }
  return result
}
export const normalize = (v: number[]) => {
  const norm = Math.sqrt(v.reduce((n, x) => n + x * x, 0))
  if (!Number.isFinite(norm) || norm < 1e-12) throw Error('无效向量')
  return v.map((x) => x / norm)
}
export const similarity = (a: number[], b: number[]) =>
  a.length === b.length ? a.reduce((n, x, i) => n + x * b[i], 0) : -1
