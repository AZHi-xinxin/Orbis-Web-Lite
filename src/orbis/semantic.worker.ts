import * as ort from 'onnxruntime-web/wasm'
import { normalize, similarity, wordpiece } from './wordpiece.js'
type Chunk = { id: string; revision: number; eventId: string; text: string }
let session: ort.InferenceSession | undefined, tokenize: ReturnType<typeof wordpiece>
const cache = new Map<string, number[]>()
async function checked(path: string, sha: string) {
  const r = await fetch(path)
  if (!r.ok) throw Error('记忆模型下载失败')
  const b = await r.arrayBuffer()
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)))
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')
  if (hash !== sha) throw Error('记忆模型校验失败')
  return b
}
async function init() {
  if (session) return
  ort.env.wasm.numThreads = 1
  ort.env.wasm.proxy = false
  ort.env.wasm.wasmPaths = new URL('/ort/', self.location.origin).href
  const [model, vocab] = await Promise.all([
    checked(
      '/memory/model.onnx',
      '15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc'
    ),
    checked(
      '/memory/vocab.txt',
      '45bbac6b341c319adc98a532532882e91a9cefc0329aa57bac9ae761c27b291c'
    ),
  ])
  tokenize = wordpiece(new TextDecoder().decode(vocab).split(/\r?\n/))
  session = await ort.InferenceSession.create(model, {
    executionProviders: ['wasm'],
    intraOpNumThreads: 1,
    interOpNumThreads: 1,
    enableMemPattern: false,
  })
}
async function encode(text: string, query = false) {
  const ids = tokenize((query ? '为这个句子生成表示以用于检索相关文章：' : '') + text),
    shape = [1, ids.length]
  const inputs: Record<string, ort.Tensor> = {
    input_ids: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), shape),
    attention_mask: new ort.Tensor('int64', new BigInt64Array(ids.length).fill(1n), shape),
  }
  if (session!.inputNames.includes('token_type_ids'))
    inputs.token_type_ids = new ort.Tensor('int64', new BigInt64Array(ids.length), shape)
  let output: Record<string, ort.Tensor> | undefined
  try {
    output = await session!.run(inputs)
    return normalize(Array.from(output.last_hidden_state.data as Float32Array).slice(0, 512))
  } finally {
    Object.values(inputs).forEach((t) => t.dispose())
    if (output) Object.values(output).forEach((t) => t.dispose())
  }
}
onmessage = async (event: MessageEvent<{ id: string; query: string; chunks: Chunk[] }>) => {
  const { id, query, chunks } = event.data
  try {
    await init()
    const q = await encode(query, true),
      ranked: { chunk: Chunk; vector: number[]; score: number }[] = []
    for (const chunk of chunks) {
      const key = chunk.id + ':' + chunk.revision + ':' + chunk.text
      let vector = cache.get(key)
      if (!vector) {
        vector = await encode(chunk.text)
        cache.set(key, vector)
        if (cache.size > 256) cache.delete(cache.keys().next().value!)
      }
      ranked.push({ chunk, vector, score: similarity(q, vector) })
    }
    ranked.sort((a, b) => b.score - a.score)
    const chosen: typeof ranked = []
    for (const hit of ranked) {
      if (hit.score < 0.5 || hit.score < (ranked[0]?.score ?? 1) - 0.06) break
      if (
        chosen.some(
          (x) =>
            x.chunk.id === hit.chunk.id ||
            x.chunk.text === hit.chunk.text ||
            similarity(x.vector, hit.vector) > 0.96
        )
      )
        continue
      chosen.push(hit)
      if (chosen.length === 3) break
    }
    postMessage({ id, selection: chosen.map((x) => ({ ...x.chunk, kind: 'semantic' })) })
  } catch (error) {
    postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
}
