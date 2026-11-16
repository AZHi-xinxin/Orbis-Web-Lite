import test from 'node:test'
import assert from 'node:assert/strict'
import { initialState, rollback, retract } from '../.test-build/src/orbis/core.js'
import { forkWindow, compactionCut, compactionText, summaryChunks, applyManualCompaction } from '../.test-build/src/orbis/contextActions.js'
import { summaryRequest, summarizeChunks } from '../.test-build/src/orbis/manualCompaction.js'
import { makeRequest } from '../.test-build/src/orbis/network.js'
import { fullBackup, restoreBackup } from '../.test-build/src/orbis/backup.js'
const setup = () => {
  const s = initialState(), w = s.windows[0]
  w.messages = Array.from({length: 8}, (_, i) => ({id:'m'+i, turn:'t'+Math.floor(i/2), role:i%2?'assistant':'user',text:'原文'+i,at:1000+i,status:'done'}))
  w.conversation = {text:'保留提示',enabled:true,world_book_text:'背景',world_book_enabled:true,allowAI:false}
  return {s,w}
}
test('fork at complete turn, independent identifiers/quotes and edits, no rules replay', () => {
  const {s,w} = setup(); w.messages[1].quoteId = 'm0'
  const original = structuredClone(w)
  s.sentinels.push({id:'only-original',window:w.id})
  const b = forkWindow(s,w.id,'m0')
  assert.equal(b.messages.length,2); assert.equal(b.messages[1].quoteId,b.messages[0].id)
  assert.notEqual(b.messages[0].turn,w.messages[0].turn)
  assert.deepEqual(b.conversation,w.conversation)
  retract(s,b.id,b.messages[0].id,'user')
  assert.deepEqual(w,original); assert.equal(s.sentinels.length,1)
  assert.deepEqual(b.compressions,[]); assert.equal(b.rollback,undefined)
  assert.throws(()=>forkWindow(s,w.id,'missing'))
  w.messages[0].status='working'; assert.throws(()=>forkWindow(s,w.id))
})
test('fork light-mode notes remain local independent copies', () => {
  const {s,w} = setup(); w.mode='light'
  s.notes.push({id:'n',window:w.id,body:'私人旧记忆',history:[]})
  const b=forkWindow(s,w.id); const note=s.notes.find(n=>n.window===b.id)
  assert.equal(note.body,'私人旧记忆'); assert.notEqual(note.id,'n');note.body='分支后改变'
  assert.equal(s.notes[0].body,'私人旧记忆')
})
test('manual commit always preserves originals, tool turns, rollback and backup import', () => {
  const {s,w}=setup();s.settings.preserveBranch=false
  const original=structuredClone(w.messages)
  const e=applyManualCompaction(s,w.id,original,'经过确认的摘要',1)
  assert.equal(compactionCut(original,1),6)
  assert.deepEqual(s.windows.find(x=>x.id===e.backupId).messages,original)
  assert.equal(w.messages.length,3);assert.equal(e.initiatedBy,'human')
  const bytes=fullBackup(s), dest=initialState();restoreBackup(dest,bytes)
  const restored=dest.windows.find(x=>x.id===w.id); assert.equal(restored.compressions[0].initiatedBy,'human')
  const later={id:'later',turn:'next',role:'user',text:'新的话',at:9000}; w.messages.push(later)
  rollback(s,w.id);assert.deepEqual(w.messages,[...original,later])
})
test('stale summary/invalid retention never overwrites changed history', () => {
  const {s,w}=setup(), originals=structuredClone(w.messages)
  w.messages[0].text='并发编辑';const before=structuredClone(s)
  assert.throws(()=>applyManualCompaction(s,w.id,originals,'摘要',0));assert.deepEqual(s,before)
  assert.throws(()=>applyManualCompaction(s,w.id,w.messages,'摘要',999));assert.deepEqual(s,before)
})
test('chunks cover long Unicode and tools exactly without binary data or reasoning', () => {
  const {w}=setup(); w.messages[0].text='😀好'.repeat(30000)
  w.messages[0].files=[{name:'pic',mime:'image/png',data:'SECRET_BINARY'},{name:'note',mime:'text/plain',data:'附件全文'}]
  w.messages[1].reasoning='隐藏思考';w.messages[1].calls=[{id:'tool',name:'dangerous',arguments:'{}'}]
  const text=compactionText(w.messages), chunks=summaryChunks(text,2000)
  assert.equal(chunks.join(''),text); assert.ok(chunks.every(c=>c.length<=2000&&!/[\uD800-\uDBFF]$/.test(c)))
  assert.ok(!text.includes('SECRET_BINARY')&&!text.includes('隐藏思考'));assert.ok(text.includes('附件全文')&&text.includes('dangerous'))
})
test('summary requests bounded and isolated from giant settings, actual protocol serialization', () => {
  const {s,w}=setup();s.settings.prompt='OLD_PROMPT'.repeat(10000);s.settings.webSearch=true;s.settings.threshold=1
  for (const protocol of ['messages','openai']) {
    s.settings.protocol=protocol
    const r=summaryRequest(s,w,'前段摘要','新片段'),body=makeRequest(r.state,r.window,r.turn,[])
    assert.equal(body.max_tokens,4096);assert.equal(body.tools.length,0)
    const text=JSON.stringify(body)
    assert.ok(text.includes('新片段')&&text.includes('前段摘要'))
    assert.ok(!text.includes('OLD_PROMPT')&&!text.includes('保留提示'))
    assert.ok(text.length<4000);assert.equal(r.turn.selection.length,0)
  }
})
test('sequential summarization covers every segment and never commits on success/failure/cancel', async () => {
  const {s,w}=setup(), before=structuredClone(s);let calls=0
  const signal=new AbortController().signal
  const model=async(_s,win)=>{calls++;assert.match(win.messages[0].text,new RegExp('块'+calls));return {text:'累计'+calls,reasoning:'',calls:[]}}
  assert.equal(await summarizeChunks(s,w,['块1','块2','块3'],signal,()=>{},model),'累计3')
  assert.equal(calls,3);assert.deepEqual(s,before)
  await assert.rejects(()=>summarizeChunks(s,w,['块'],signal,()=>{},async()=>({text:'不完整',calls:[],truncated:true})))
  const c=new AbortController();c.abort()
  await assert.rejects(()=>summarizeChunks(s,w,['块'],c.signal,()=>{},model));assert.deepEqual(s,before)
  await assert.rejects(()=>summarizeChunks(s,w,['块'],signal,()=>{},async()=>{throw Error('HTTP 400')}));assert.deepEqual(s,before)
})

test('fork copies completed voice archives and remaps records without leaking later calls', () => {
 const {s,w}=setup(); w.messages[0].voiceSessionId='voice';w.messages[1].voiceSessionId='voice'
 w.voiceSessions=[{id:'voice',startedAt:999,endedAt:1001,status:'ended',summaryStatus:'done',summary:'通话总结',raw:structuredClone(w.messages.slice(0,2))}]
 const b=forkWindow(s,w.id)
 assert.equal(b.voiceSessions.length,1);assert.equal(b.voiceSessions[0].summary,'通话总结')
 assert.equal(b.voiceSessions[0].raw[0].id,b.messages[0].id)
 assert.equal(b.voiceSessions[0].id,b.messages[0].voiceSessionId)
 assert.notEqual(b.voiceSessions[0].id,'voice')
})
