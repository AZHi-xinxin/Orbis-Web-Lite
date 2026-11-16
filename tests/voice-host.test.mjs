import test from 'node:test'
import assert from 'node:assert/strict'
import { initialState, freezeMemory } from '../.test-build/src/orbis/core.js'
import { enabledTools, makeRequest } from '../.test-build/src/orbis/network.js'
import {
  registerVoiceHost,
  requestIncoming,
  respondIncoming,
  incomingCall,
  boundCall,
  endBoundCall,
  setActiveCall,
  clearActiveCall,
} from '../.test-build/src/orbis/voiceHost.js'

globalThis.window = new EventTarget()
globalThis.document = { hidden: false }
const invite = (id = 'i1') => ({
  id,
  window: 'w',
  turn: 't',
  reason: '合成邀请',
  deadline: Date.now() + 5000,
})
test('incoming calls require acceptance, cancel cleanly, and cannot end a newer call', async () => {
  let accepted = 0,
    ended = 0
  const close = registerVoiceHost({
    available: (w) => w === 'w',
    accept: () => accepted++,
    end: () => ended++,
  })
  const controller = new AbortController()
  const first = requestIncoming(invite(), controller.signal)
  assert.equal(accepted, 0)
  assert.equal(boundCall('w'), undefined)
  respondIncoming(false)
  assert.equal(await first, 'rejected')
  assert.equal(accepted, 0)
  const second = requestIncoming(invite('i2'), controller.signal)
  respondIncoming(true)
  assert.equal(await second, 'accepted')
  assert.equal(accepted, 1)
  assert.equal(boundCall('w'), 'i2')
  assert.equal(endBoundCall('other', 'i2').status, 'already_ended')
  assert.equal(ended, 0)
  setActiveCall('w', 'newer')
  assert.equal(endBoundCall('w', 'i2').status, 'already_ended')
  assert.equal(ended, 0)
  assert.equal(endBoundCall('w', 'newer').status, 'ended')
  assert.equal(ended, 1)
  const waiting = requestIncoming(invite('cancel'), controller.signal)
  controller.abort()
  assert.equal(await waiting, 'cancelled')
  assert.equal(incomingCall(), undefined)
  const timeout = requestIncoming(
    { ...invite('timeout'), deadline: Date.now() + 10 },
    new AbortController().signal
  )
  assert.equal(await timeout, 'no_response')
  assert.equal(accepted, 1)
  const pending = requestIncoming(invite('reload'), new AbortController().signal)
  close()
  assert.equal(await pending, 'cancelled')
  assert.equal(await requestIncoming(invite(), new AbortController().signal), 'unavailable')
})
test('permissions hide AI voice tools by default; UI voice records do not break tool history', () => {
  const s = initialState(),
    w = s.windows[0]
  assert(
    !enabledTools(s, w.id).some((t) =>
      ['orbis_voice_note', 'start_voice_call', 'end_voice_call'].includes(t.name)
    )
  )
  s.settings.speech = { ...s.settings.speech, allowVoiceNotes: true, allowIncomingCalls: true }
  assert(enabledTools(s, w.id).some((t) => t.name === 'orbis_voice_note'))
  assert(enabledTools(s, w.id).some((t) => t.name === 'start_voice_call'))
  const turn = 'turn'
  const base = { at: 1, status: 'done', turn }
  w.messages = [
    { ...base, id: 'u', role: 'user', text: '来一段语音' },
    {
      ...base,
      id: 'a',
      role: 'assistant',
      text: '',
      calls: [{ id: 'tc', name: 'orbis_voice_note', arguments: '{"text":"你好"}' }],
    },
    { ...base, id: 'note', role: 'assistant', text: '你好', voiceNote: true, files: [] },
    {
      ...base,
      id: 'ring',
      role: 'assistant',
      text: '来电',
      voiceCall: { id: 'c', reason: '来电', status: 'rejected' },
    },
    {
      ...base,
      id: 'result',
      role: 'tool',
      text: '{"status":"sent","transcript":"你好"}',
      callId: 'tc',
      name: 'orbis_voice_note',
    },
  ]
  const frozen = freezeMemory(s, w.id, turn, '来一段语音')
  const body = makeRequest(s, w, frozen, enabledTools(s, w.id))
  assert(!JSON.stringify(body).includes('voiceNote'))
  assert(!JSON.stringify(body).includes('voiceCall'))
  assert.equal(body.messages.length, 3)
  assert.equal(body.messages[1].content[0].type, 'tool_use')
  assert.equal(body.messages[2].content[0].type, 'tool_result')
  s.settings.protocol = 'openai'
  const openai = makeRequest(s, w, freezeMemory(s, w.id, 'next', ''), [])
  const requestIndex = openai.messages.findIndex((m) => m.tool_calls?.length)
  assert.equal(openai.messages[requestIndex + 1].role, 'tool')
  assert.equal(openai.messages[requestIndex + 1].tool_call_id, 'tc')
  clearActiveCall()
})
