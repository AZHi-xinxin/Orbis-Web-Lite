import test from 'node:test'
import assert from 'node:assert/strict'
import { initialState, readWindow, retract } from '../.test-build/src/orbis/core.js'
import { beginVoiceSession, finishVoiceSession, callDisplayMessages, callTranscript } from '../.test-build/src/orbis/callArchive.js'
import { fullBackup, restoreBackup } from '../.test-build/src/orbis/backup.js'

test('call card is only a projection; raw audio and signed tool chain remain unchanged', () => {
  const s=initialState(), w=s.windows[0]
  beginVoiceSession(s,w.id,'call-a',1000)
  const records=[{id:'human',turn:'turn',role:'user',text:'明天去散步',at:1100,voiceSessionId:'call-a',files:[{id:'wav',mime:'audio/wav',name:'voice',size:4,data:'data:audio/wav;base64,AAAA'}]},
    {id:'model',turn:'turn',role:'assistant',text:'好，明天见。',at:1200,voiceSessionId:'call-a',thinkingBlocks:[{type:'thinking',signature:'untouched'}]},
    {id:'tool',turn:'turn',role:'tool',text:'{"saved":true}',callId:'tool-call',at:1250,voiceSessionId:'call-a'}]
  w.messages.push(...records)
  const before=structuredClone(w.messages)
  finishVoiceSession(s,w.id,'call-a',5000)
  assert.deepEqual(w.messages,before)
  const visible=callDisplayMessages(w,w.messages)
  assert.equal(visible.filter(m=>m.voiceSessionEnd==='call-a').length,1)
  assert.equal(visible.some(m=>m.id==='human'),false)
  assert.deepEqual(w.voiceSessions[0].raw,before)
  assert.match(callTranscript(w.voiceSessions[0]),/明天去散步/)
  assert.doesNotMatch(callTranscript(w.voiceSessions[0]),/saved/)
  assert.equal(readWindow(s,w.id,w.id,0,20,'call-a').messages[0].files[0].data,records[0].files[0].data)
  assert.throws(()=>readWindow(s,w.id,w.id,0,20,'missing'))
})

test('hangup snapshot is idempotent and calls stay isolated',()=>{
  const s=initialState(),w=s.windows[0]
  beginVoiceSession(s,w.id,'one',10);beginVoiceSession(s,w.id,'one',20)
  assert.equal(w.voiceSessions.length,1)
  w.messages.push({id:'one',turn:'x',role:'user',text:'first',at:21,voiceSessionId:'one'})
  finishVoiceSession(s,w.id,'one',30)
  beginVoiceSession(s,w.id,'two',40)
  w.messages.push({id:'two',turn:'y',role:'user',text:'second',at:41,voiceSessionId:'two'})
  finishVoiceSession(s,w.id,'one',99)
  assert.equal(w.voiceSessions[0].endedAt,30)
  assert.equal(w.voiceSessions[0].raw.length,1)
  finishVoiceSession(s,w.id,'two',50)
  assert.equal(callDisplayMessages(w,w.messages).length,2)
})

test('full backup carries call originals and summaries with duplicate import adding zero',()=>{
  const s=initialState(),w=s.windows[0]
  beginVoiceSession(s,w.id,'saved',1)
  w.messages.push({id:'m',turn:'t',role:'user',text:'保存通话',at:2,voiceSessionId:'saved'})
  finishVoiceSession(s,w.id,'saved',3)
  w.voiceSessions[0].summary='聊了保存通话';w.voiceSessions[0].summaryStatus='done'
  const bytes=fullBackup(s),next=initialState()
  const result=restoreBackup(next,bytes)
  const copy=next.windows.find(x=>x.voiceSessions?.length)
  assert.equal(copy.voiceSessions[0].summary,'聊了保存通话')
  assert.equal(copy.voiceSessions[0].raw[0].text,'保存通话')
  assert.equal(restoreBackup(next,bytes).windows,0)
})


test('retraction removes archived audio and invalidates an old call summary',()=>{
 const s=initialState(),w=s.windows[0]
 beginVoiceSession(s,w.id,'r',1)
 w.messages.push({id:'private',turn:'t',role:'user',text:'要撤回的合成文字',at:2,voiceSessionId:'r',files:[{id:'a',name:'a',mime:'audio/wav',data:'data:audio/wav;base64,AAAA',size:3}]})
 finishVoiceSession(s,w.id,'r',3);w.voiceSessions[0].summary='旧总结';w.voiceSessions[0].summaryStatus='done'
 retract(s,w.id,'private','user')
 assert.equal(w.voiceSessions[0].raw[0].text,'');assert.equal(w.voiceSessions[0].raw[0].files,undefined)
 assert.equal(w.voiceSessions[0].summary,undefined);assert.equal(w.voiceSessions[0].summaryStatus,'failed')
})
