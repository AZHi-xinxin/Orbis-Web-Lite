import { fullBackup, restoreBackup } from './backup.js'
import { initialState, type State } from './core.js'
const LIMIT = 128 * 1024 * 1024
const encode = (bytes: Uint8Array) => {
  let text = ''
  for (let i = 0; i < bytes.length; i += 32768)
    text += String.fromCharCode(...bytes.subarray(i, i + 32768))
  return btoa(text)
}
const decode = (text: unknown, max = LIMIT) => {
  if (typeof text !== 'string' || text.length > Math.ceil((max * 4) / 3) + 4)
    throw Error('备份数据过大或格式错误')
  const binary = atob(text)
  if (binary.length > max) throw Error('备份数据过大')
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}
const derive = async (password: string, salt: Uint8Array, usages: KeyUsage[]) => {
  if (password.length < 8) throw Error('备份密码至少 8 个字符，请另行妥善保存')
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 310000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usages
  )
}
export async function encryptedBackup(
  state: State,
  password: string,
  secrets: Record<string, string> = {}
): Promise<Uint8Array> {
  const zip = fullBackup(state)
  const payload = new TextEncoder().encode(
    JSON.stringify({ format: 'orbis-portable-payload/1', zip: encode(zip), secrets })
  )
  if (payload.length > LIMIT) throw Error('加密迁移包过大，请先另存大型附件')
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await derive(password, salt, ['encrypt'])
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('orbis-portable/1') },
    key,
    payload
  )
  return new TextEncoder().encode(
    JSON.stringify({
      format: 'orbis-portable/1',
      algorithm: 'PBKDF2-SHA256/AES-256-GCM',
      salt: encode(salt),
      iv: encode(iv),
      ciphertext: encode(new Uint8Array(encrypted)),
    })
  )
}
export async function openBackup(
  bytes: Uint8Array,
  password: string
): Promise<{ zip: Uint8Array; secrets: Record<string, string>; encrypted: boolean }> {
  if (bytes.length > LIMIT * 1.4) throw Error('备份文件过大')
  let zip = bytes,
    secrets: Record<string, string> = {},
    encrypted = false
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    encrypted = true
    let envelope: any
    try {
      envelope = JSON.parse(new TextDecoder().decode(bytes))
    } catch {
      throw Error('不是 Lite 完整备份，请选择 ZIP 或 .orbis 文件')
    }
    if (
      envelope.format !== 'orbis-portable/1' ||
      envelope.algorithm !== 'PBKDF2-SHA256/AES-256-GCM'
    )
      throw Error('不是受支持的 Lite 加密备份')
    const salt = decode(envelope.salt, 16),
      iv = decode(envelope.iv, 12)
    if (salt.length !== 16 || iv.length !== 12) throw Error('备份头损坏')
    const key = await derive(password, salt, ['decrypt'])
    let payload: any
    try {
      payload = JSON.parse(
        new TextDecoder().decode(
          await crypto.subtle.decrypt(
            {
              name: 'AES-GCM',
              iv: iv as BufferSource,
              additionalData: new TextEncoder().encode('orbis-portable/1'),
            },
            key,
            decode(envelope.ciphertext) as BufferSource
          )
        )
      )
    } catch {
      throw Error('密码不正确或备份已损坏；没有改动当前数据')
    }
    if (payload.format !== 'orbis-portable-payload/1') throw Error('备份内容格式错误')
    zip = decode(payload.zip)
    if (!payload.secrets || typeof payload.secrets !== 'object' || Array.isArray(payload.secrets))
      throw Error('密钥配置格式错误')
    for (const [k, v] of Object.entries(payload.secrets)) {
      if (
        !/^(api|asr|tts|mcp:[A-Za-z0-9_-]{1,100})$/.test(k) ||
        typeof v !== 'string' ||
        v.length > 16384
      )
        throw Error('密钥配置格式错误')
      secrets[k] = v
    }
  }
  // Fully validate before opening the application's write transaction.
  restoreBackup(initialState(), zip, { settings: true, tasks: true })
  return { zip, secrets, encrypted }
}
