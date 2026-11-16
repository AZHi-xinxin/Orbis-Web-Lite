import { Inflate } from 'fflate'
import { importJson } from './importJson.js'

export type ZipEntry = {
  name: string
  size: number
  compressed: number
  crc: number
  offset: number
  method: number
  flags: number
}
const decoder = new TextDecoder('utf-8', { fatal: true })
export const safeZipPath = (name: string) =>
  name.length > 0 &&
  !name.startsWith('/') &&
  !/[\\:]/.test(name) && !Array.from(name).some(c => c.charCodeAt(0) < 32) &&
  !name
    .replace(/\/$/, '')
    .split('/')
    .some((p) => !p || p === '.' || p === '..')
const table = Uint32Array.from({ length: 256 }, (_, i) => {
  for (let k = 0; k < 8; k++) {
    i = i & 1 ? 0xedb88320 ^ (i >>> 1) : i >>> 1
  }
  return i >>> 0
})
function check(ok: unknown, message = 'ZIP 结构损坏或格式不支持；当前聊天未改动'): asserts ok {
  if (!ok) {
    throw Error(message)
  }
}
/** Read the directory and individual entries from a Blob. Never read the entire archive. */
export class LocalZip {
  private constructor(
    readonly file: Blob,
    readonly entries: Map<string, ZipEntry>,
    private directory: number
  ) {}
  static async open(file: Blob) {
    const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 65557)).arrayBuffer())
    const view = new DataView(tail.buffer)
    let end = -1
    for (let p = tail.length - 22; p >= 0; p--) {
      if (
        view.getUint32(p, true) === 0x06054b50 &&
        p + 22 + view.getUint16(p + 20, true) === tail.length
      ) {
        end = p
        break
      }
    }
    check(end >= 0)
    const count = view.getUint16(end + 10, true),
      length = view.getUint32(end + 12, true),
      offset = view.getUint32(end + 16, true)
    check(
      count !== 65535 && offset !== 0xffffffff && length !== 0xffffffff,
      '暂不支持 ZIP64 导出包，请按会话拆分后导入；原文件未改动'
    )
    check(view.getUint32(end + 4, true) === 0 && view.getUint16(end + 8, true) === count)
    check(
      count > 0 &&
        count <= 50000 &&
        length <= 16 * 1024 * 1024 &&
        offset + length <= file.size - tail.length + end
    )
    const bytes = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()),
      d = new DataView(bytes.buffer)
    const entries = new Map<string, ZipEntry>()
    let p = 0
    for (let i = 0; i < count; i++) {
      check(p + 46 <= bytes.length && d.getUint32(p, true) === 0x02014b50)
      const n = d.getUint16(p + 28, true),
        extra = d.getUint16(p + 30, true),
        comment = d.getUint16(p + 32, true)
      check(p + 46 + n + extra + comment <= bytes.length)
      const name = decoder.decode(bytes.subarray(p + 46, p + 46 + n))
      check(safeZipPath(name) && !entries.has(name), 'ZIP 含重复或不安全路径；当前聊天未改动')
      const entry = {
        name,
        flags: d.getUint16(p + 8, true),
        method: d.getUint16(p + 10, true),
        crc: d.getUint32(p + 16, true),
        compressed: d.getUint32(p + 20, true),
        size: d.getUint32(p + 24, true),
        offset: d.getUint32(p + 42, true),
      }
      check(
        entry.offset < offset &&
          entry.offset + entry.compressed <= offset &&
          d.getUint16(p + 34, true) === 0
      )
      entries.set(name, entry)
      p += 46 + n + extra + comment
    }
    check(p === bytes.length)
    return new LocalZip(file, entries, offset)
  }
  async stream(
    name: string,
    receive: (part: Uint8Array) => void,
    maxBytes = Number.MAX_SAFE_INTEGER
  ) {
    const entry = this.entries.get(name)
    check(entry, '导出包缺少所需文件；当前会话未导入')
    check(
      entry.size <= maxBytes,
      `单个内容文件超过 ${maxBytes / 1024 / 1024} MiB，当前会话未导入；请保留原包`
    )
    check(!(entry.flags & 1) && [0, 8].includes(entry.method), '不支持加密 ZIP 或此压缩方式')
    const header = new DataView(
      await this.file.slice(entry.offset, entry.offset + 30).arrayBuffer()
    )
    check(
      header.byteLength === 30 &&
        header.getUint32(0, true) === 0x04034b50 &&
        header.getUint16(6, true) === entry.flags &&
        header.getUint16(8, true) === entry.method
    )
    const n = header.getUint16(26, true),
      extra = header.getUint16(28, true)
    check(
      decoder.decode(
        await this.file.slice(entry.offset + 30, entry.offset + 30 + n).arrayBuffer()
      ) === name
    )
    const start = entry.offset + 30 + n + extra
    check(start + entry.compressed <= this.directory)
    let size = 0,
      crc = 0xffffffff
    const append = (part: Uint8Array) => {
      size += part.length
      check(size <= entry.size && size <= maxBytes, '解压大小异常，当前会话未导入')
      for (const value of part) {
        crc = table[(crc ^ value) & 255] ^ (crc >>> 8)
      }
      receive(part)
    }
    const inflate = entry.method === 8 ? new Inflate(append) : undefined
    for (let p = 0; p < entry.compressed; p += 16384) {
      const end = Math.min(p + 16384, entry.compressed)
      const bytes = new Uint8Array(await this.file.slice(start + p, start + end).arrayBuffer())
      if (inflate) {
        inflate.push(bytes, end === entry.compressed)
      } else {
        append(bytes)
      }
    }
    check(
      size === entry.size && (crc ^ 0xffffffff) >>> 0 === entry.crc,
      'ZIP 内容校验失败，当前会话未导入'
    )
    return size
  }
  async read(name: string, maxBytes = 64 * 1024 * 1024) {
    const parts: Uint8Array[] = []
    const size = await this.stream(name, (part) => parts.push(part), maxBytes)
    const result = new Uint8Array(size)
    let p = 0
    for (const part of parts) {
      result.set(part, p)
      p += part.length
    }
    return result
  }
  async json(name: string) {
    return importJson(decoder.decode(await this.read(name)))
  }
}
