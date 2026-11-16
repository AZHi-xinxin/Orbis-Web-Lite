import test from 'node:test'
import assert from 'node:assert/strict'
import {
  initialState,
  freezeMemory,
  compact,
  rollback,
  memoryAction,
  retract,
  uid,
} from '../.test-build/src/orbis/core.js'
import { makeRequest, streamModel, enabledTools } from '../.test-build/src/orbis/network.js'
import { fullBackup, restoreBackup } from '../.test-build/src/orbis/backup.js'
import { encryptedBackup, openBackup } from '../.test-build/src/orbis/portableBackup.js'
import { providerIdentity, webSources } from '../.test-build/src/orbis/webSearch.js'
import {
  saveSecret,
  secret,
  remembersSecrets,
  rememberSecrets,
  secretSnapshot,
} from '../.test-build/src/orbis/storage.js'
import {
  speechCredential,
  speechURL,
  speechChunks,
  transcribeSpeech,
} from '../.test-build/src/orbis/speech.js'
function storage() {
  const x = {}
  Object.defineProperties(x, {
    getItem: { value: (k) => x[k] ?? null },
    setItem: {
      value: (k, v) => {
        x[k] = String(v)
      },
    },
    removeItem: {
      value: (k) => {
        delete x[k]
      },
    },
  })
  return x
}
function keys() {
  globalThis.sessionStorage = storage()
  globalThis.localStorage = storage()
  saveSecret('api', 'synthetic-key')
}
const msg = (text, role = 'user', turn = uid()) => ({
  id: uid(),
  turn,
  role,
  text,
  at: Date.now(),
  status: 'done',
})
const fixture = () => {
  const s = initialState(),
    w = s.windows[0]
  s.settings.webSearch = true
  w.messages = [msg('搜索今天的资料')]
  return { s, w, turn: freezeMemory(s, w.id, uid(), '搜索') }
}
const sse = (events) =>
  new Response(events.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join(''), {
    headers: { 'content-type': 'text/event-stream' },
  })
test('native search coexists with local tools in both protocols and rejects unsupported model', () => {
  for (const protocol of ['messages', 'openai']) {
    const { s, w } = fixture()
    s.settings.protocol = protocol
    const t = freezeMemory(s, w.id, uid(), '搜索')
    const body = makeRequest(s, w, t, enabledTools(s))
    assert.equal(body.tools[0].type, 'deepseek_web_search')
    assert.ok(body.tools.some((t) => (t.name ?? t.function?.name) === 'orbis_memory'))
    assert.deepEqual(body.safety_check, { level: 'high' })
    assert.ok(!enabledTools(s).some((t) => t.name === 'deepseek_web_search'))
  }
  const { s, w } = fixture()
  s.settings.model = 'pro'
  assert.throws(() => makeRequest(s, w, freezeMemory(s, w.id, uid(), '搜索'), []), /deepseek-flash/)
})
test('Messages search preserves signatures, citations and client call inputs across tool continuation', async (t) => {
  keys()
  const { s, w, turn } = fixture()
  const blocks = [
    {
      type: 'server_tool_use',
      id: 'web1',
      name: 'deepseek_web_search',
      kind: 'web_search',
      input: { queries: ['fixture'] },
    },
    {
      type: 'web_search_tool_result',
      tool_use_id: 'web1',
      content: [{ type: 'web_search_result', url: 'https://example.org/report', title: '资料' }],
    },
    {
      type: 'server_tool_use',
      id: 'read1',
      name: 'deepseek_read_url',
      kind: 'web_fetch',
      input: { url: 'https://example.org/report' },
    },
    {
      type: 'web_fetch_tool_result',
      tool_use_id: 'read1',
      signature: 'opaque-signature',
      content: {
        type: 'web_fetch_result',
        url: 'https://example.org/report',
        content: { title: '资料', source: { data: 'article' } },
      },
    },
    { type: 'text', text: '找到资料' },
    { type: 'tool_use', id: 'local1', name: 'orbis_memory', input: {} },
  ]
  const events = blocks.map((b, i) => ({ type: 'content_block_start', index: i, content_block: b }))
  events.push(
    {
      type: 'content_block_delta',
      index: 4,
      delta: {
        type: 'citations_delta',
        citation: {
          type: 'web_search_result_location',
          url: 'https://example.org/report',
          title: '资料',
          encrypted_index: 'opaque-index',
        },
      },
    },
    {
      type: 'content_block_delta',
      index: 5,
      delta: { type: 'input_json_delta', partial_json: '{"body":"synthetic"}' },
    },
    { type: 'message_stop' }
  )
  t.mock.method(globalThis, 'fetch', async () => sse(events))
  const out = await streamModel(s, w, turn, enabledTools(s), new AbortController().signal, () => {})
  assert.deepEqual(
    out.calls.map((c) => c.name),
    ['orbis_memory']
  )
  assert.equal(out.web.calls.length, 2)
  assert.equal(out.web.calls[1].status, 'done')
  assert.equal(webSources({ ...msg('', 'assistant'), web: out.web }).length, 1)
  w.messages.push({ ...msg(out.text, 'assistant'), ...out })
  w.messages.push({ ...msg('saved', 'tool'), callId: 'local1' })
  const replay = makeRequest(s, w, turn, enabledTools(s))
  const replayed = replay.messages.find((m) => m.role === 'assistant').content
  const content = replayed.filter(b => !(b.type === 'text' && b.text.startsWith('[宿主消息记录时间，非正文]')))
  assert.deepEqual(content, out.providerContent)
  assert.equal(content[3].signature, 'opaque-signature')
  assert.equal(content[4].citations[0].encrypted_index, 'opaque-index')
  assert.deepEqual(content[5].input, { body: 'synthetic' })
  s.settings.endpoint = 'https://other.example'
  s.settings.webSearch = false
  const changed = makeRequest(s, w, freezeMemory(s, w.id, uid(), '继续'), [])
  assert.ok(!JSON.stringify(changed).includes('opaque-signature'))
})
test('OpenAI server events render sources but never become executable function calls', async (t) => {
  keys()
  const { s, w } = fixture()
  s.settings.protocol = 'openai'
  const turn = freezeMemory(s, w.id, uid(), '搜索')
  const call = {
    id: 'search1',
    status: 'completed',
    action: { type: 'search', queries: ['fixture'] },
    sources: [{ url: 'https://example.org/a', title: 'A' }],
  }
  const server = [{ calls: [call] }]
  t.mock.method(globalThis, 'fetch', async () =>
    sse([
      { choices: [{ server_tool_event: { type: 'call_completed', call }, delta: {} }] },
      {
        choices: [
          {
            delta: {
              content: '答案',
              server_tool_calls: server,
              annotations: [
                {
                  type: 'url_citation',
                  url_citation: { url: 'https://example.org/a', title: 'A' },
                },
              ],
            },
            finish_reason: 'stop',
          },
        ],
      },
    ])
  )
  const out = await streamModel(s, w, turn, [], new AbortController().signal, () => {})
  assert.equal(out.calls.length, 0)
  assert.equal(out.web.calls[0].status, 'done')
  w.messages.push({ ...msg(out.text, 'assistant'), ...out })
  assert.deepEqual(makeRequest(s, w, turn, []).messages.at(-1).server_tool_calls, server)
})
test('retraction scrubs signed search content from originals and request; unsafe sources omitted', () => {
  const { s, w, turn } = fixture()
  const m = {
    ...msg('私有测试文本', 'assistant'),
    providerIdentity: providerIdentity(s.settings),
    providerContent: [{ type: 'text', text: '私有测试文本' }],
    web: { calls: [], citations: [{ url: 'javascript:alert(1)', title: 'bad' }] },
  }
  w.messages.push(m)
  assert.equal(webSources(m).length, 0)
  retract(s, w.id, m.id, 'assistant')
  assert.ok(!JSON.stringify(s).includes('私有测试文本'))
  assert.ok(!JSON.stringify(makeRequest(s, w, turn, [])).includes('私有测试文本'))
})
test('full Lite restore retains media, memory, frozen traces, settings and usable rollback; imports disabled tasks', () => {
  const s = initialState(),
    w = s.windows[0]
  s.settings.userName = '测试用户'
  s.settings.webSearch = true
  s.settings.generation = { reasoning: 'high' }
  w.conversation = {
    enabled: true,
    text: '提示词',
    world_book_enabled: true,
    world_book_text: '背景',
    allowAI: true,
  }
  w.messages = Array.from({ length: 7 }, (_, i) => msg('正文' + i))
  w.messages[0].files = [
    {
      id: 'audio',
      name: '片段.wav',
      mime: 'audio/wav',
      size: 3,
      data: 'data:audio/wav;base64,QUJD',
    },
  ]
  const original = structuredClone(w.messages)
  memoryAction(s, w.id, { body: '记忆原文', state: 'conditional', keywords: ['正文'] })
  freezeMemory(s, w.id, w.messages[0].turn, '正文')
  compact(s, w.id, '摘要', 1)
  s.sentinels = [
    {
      id: 'rule',
      window: w.id,
      name: '提醒',
      prompt: 'hello',
      kind: 'interval',
      due: Date.now(),
      interval: 60000,
      daily: '09:00',
      timezone: 'UTC',
      enabled: true,
    },
  ]
  s.mcp = [
    {
      id: 'remote',
      name: 'M',
      url: 'https://example.org/mcp',
      tools: [
        { name: 'query', description: '查询', inputSchema: { type: 'object' }, enabled: true },
      ],
    },
  ]
  const target = initialState()
  const result = restoreBackup(target, fullBackup(s), { settings: true, tasks: true })
  assert.equal(result.windows, 2)
  assert.equal(target.settings.userName, '测试用户')
  assert.equal(target.settings.webSearch, true)
  assert.equal(target.sentinels[0].enabled, false)
  assert.equal(target.settings.sentinelEnabled, false)
  assert.equal(target.mcp[0].tools[0].enabled, false)
  assert.equal(target.turns.length, 1)
  assert.equal(target.windows.find((x) => x.id === w.id).conversation.world_book_text, '背景')
  rollback(target, w.id)
  assert.deepEqual(target.windows.find((x) => x.id === w.id).messages, original)
  const again = restoreBackup(target, fullBackup(s), { settings: true, tasks: true })
  assert.equal(again.windows, 0)
  assert.equal(again.notes, 0)
  assert.equal(target.sentinels.length, 1)
})
test('encrypted backup restores optional keys; wrong password or modified ciphertext fails before mutation', async () => {
  const s = initialState()
  s.windows[0].messages = [msg('加密测试记录')]
  const encrypted = await encryptedBackup(s, 'password-fixture', {
    api: 'synthetic-key',
    asr: 'other-test-key',
  })
  assert.ok(!new TextDecoder().decode(encrypted).includes('synthetic-key'))
  const opened = await openBackup(encrypted, 'password-fixture')
  assert.deepEqual(opened.secrets, { api: 'synthetic-key', asr: 'other-test-key' })
  const target = initialState()
  restoreBackup(target, opened.zip, { settings: true })
  assert.equal(target.windows.at(-1).messages[0].text, '加密测试记录')
  await assert.rejects(openBackup(encrypted, 'wrong-password'), /密码不正确/)
  const envelope = JSON.parse(new TextDecoder().decode(encrypted))
  envelope.ciphertext = (envelope.ciphertext[0] === 'A' ? 'B' : 'A') + envelope.ciphertext.slice(1)
  await assert.rejects(
    openBackup(new TextEncoder().encode(JSON.stringify(envelope)), 'password-fixture'),
    /损坏/
  )
  const plain = await openBackup(fullBackup(s), '')
  assert.deepEqual(plain.secrets, {})
  assert.equal(plain.encrypted, false)
})
test('keys persist only by opt-in and disabling clears local copy while current session works', () => {
  keys()
  assert.equal(remembersSecrets(), false)
  assert.equal(localStorage.getItem('orbis-secret:api'), null)
  rememberSecrets(true)
  globalThis.sessionStorage = storage()
  assert.equal(secret('api'), 'synthetic-key')
  saveSecret('tts', 'speech-key')
  assert.deepEqual(secretSnapshot(), { api: 'synthetic-key', tts: 'speech-key' })
  rememberSecrets(false)
  assert.equal(localStorage.getItem('orbis-secret:api'), null)
  assert.equal(secret('tts'), 'speech-key')
  globalThis.sessionStorage = storage()
  assert.equal(secret('api'), '')
})
test('speech key reuse checks origin, accepts separate key, and normalizes official /v1 URLs', async (t) => {
  keys()
  const s = initialState()
  assert.equal(
    speechURL('https://api.deepseek.com/anthropic/v1/', 'asr'),
    'https://api.deepseek.com/v1/tools/asr'
  )
  assert.equal(speechCredential(s.settings, 'asr').key, 'synthetic-key')
  s.settings.endpoint = 'https://other.example'
  assert.throws(() => speechCredential(s.settings, 'asr'), /地址不同/)
  s.settings.speech = { asrReuseModelKey: false }
  saveSecret('asr', 'asr-fixture')
  assert.equal(speechCredential(s.settings, 'asr').key, 'asr-fixture')
  assert.throws(() => speechURL('http://example.org', 'tts'), /HTTPS/)
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://api.deepseek.com/v1/tools/asr')
    assert.equal(init.headers.Authorization, 'Bearer asr-fixture')
    assert.equal(init.body.get('file').name, 'recording.wav')
    return Response.json({ text: '转写测试', duration_ms: 1000 })
  })
  assert.equal(
    await transcribeSpeech(s.settings, new Blob(['wav']), new AbortController().signal),
    '转写测试'
  )
  const text = '😀中'.repeat(3000)
  assert.equal(speechChunks(text).join(''), text)
  assert.ok(speechChunks(text).every((t) => Array.from(t).length <= 2000))
})

test('changed source window import isolates compression lineage and repeated restore stays idempotent', () => {
  const s = initialState(),
    w = s.windows[0]
  w.messages = [msg('旧1'), msg('旧2'), msg('新')]
  const e = compact(s, w.id, '原摘要', 1)
  const archive = fullBackup(s)
  w.messages.push(msg('本地追加'))
  const result = restoreBackup(s, archive, { settings: true })
  assert.equal(result.windows, 1)
  const imported = s.windows.at(-1)
  assert.notEqual(imported.compressions[0].id, e.id)
  assert.equal(imported.rollback.event, imported.compressions[0].id)
  rollback(s, imported.id)
  assert.equal(w.compressions[0].rolledBack, false)
  assert.equal(restoreBackup(s, archive).windows, 0)
})
