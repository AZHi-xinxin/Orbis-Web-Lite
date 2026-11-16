import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfm } from 'micromark-extension-gfm'
import { gfmFromMarkdown } from 'mdast-util-gfm'
/** Presentation slices only; concatenating slices reproduces the exact source. */
export function bubbles(text: string, enabled: boolean): string[] {
  if (!enabled || !text || /\\\[|\\\(|\$\$/.test(text)) return [text]
  try {
    const tree = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
    if (tree.children.some((n) => ['definition', 'html'].includes(n.type))) return [text]
    const starts = tree.children
      .map((n) => n.position?.start.offset)
      .filter((x): x is number => x !== undefined)
    if (starts.length < 2) return [text]
    starts[0] = 0
    return starts.map((start, i) => text.slice(start, starts[i + 1] ?? text.length))
  } catch {
    return [text]
  }
}
