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

test('88 independent summaries: bounded concurrency, failure persists out-of-order results, resumes only missing', async () => {
 const {resumeSummaries,defaultSummaryOptions,summaryDraftText,reviewedSegments}=await import('../.test-build/src/orbis/manualCompaction.js')
 const {s,w}=setup(),before=structuredClone(s),chunks=Array.from({length:88},(_,i)=>'片段'+i)
 let active=0,peak=0,saved=[],failed=false;const seen=[];const options={...defaultSummaryOptions(),instructions:'以阿止第一人称总结'}
 const model=async(state,win)=>{
  const body=JSON.parse(win.messages[0].text),i=Number(body.next_history_fragment.slice(2));seen.push(i)
  assert.equal(body.previous_summary,undefined);assert.ok(state.settings.prompt.includes(options.instructions));assert.equal(state.settings.generation.maxTokens,8192)
  active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,(i%3+1)*2));active--
  if(i===4&&!failed){failed=true;return {text:'被截断的摘要',reasoning:'',calls:[],truncated:true}}
  return {text:'我记得第'+i+'段的约定',reasoning:'',calls:[]}
 }
 await assert.rejects(()=>resumeSummaries(s,w,chunks,[],options,new AbortController().signal,async v=>{saved=structuredClone(v)},()=>{},model),/第 5 \/ 88 段未完成.*被截断/)
 assert.equal(saved[4],null);assert.ok(saved[5]);assert.equal(peak,3);assert.ok(seen.length<88)
 const successful=seen.filter(i=>i!==4),oldSeen=seen.length
 const result=await resumeSummaries(s,w,chunks,saved,options,new AbortController().signal,async v=>{saved=structuredClone(v)},()=>{},model)
 assert.equal(result.length,88);assert.equal(new Set(seen.slice(oldSeen)).size,88-successful.length)
 assert.ok(successful.every(i=>!seen.slice(oldSeen).includes(i)));assert.deepEqual(s,before)
 const text=summaryDraftText(result,'segments');assert.equal(reviewedSegments(text,88).length,88)
 const event=applyManualCompaction(s,w.id,structuredClone(w.messages),text,0,reviewedSegments(text,88))
 assert.equal(s.windows.length,2);assert.equal(s.notes.length,88);assert.equal(event.segments.length,88);assert.equal(w.messages.length,1)
 assert.equal(s.notes[4].body,'我记得第4段的约定')
 const {semanticSources}=await import('../.test-build/src/orbis/core.js');assert.equal(semanticSources(s).length,88)
 const dest=initialState();restoreBackup(dest,fullBackup(s));assert.equal(semanticSources(dest).length,88)
 rollback(s,w.id);assert.deepEqual(w.messages,before.windows[0].messages);assert.equal(semanticSources(s).length,0)
})
test('cancel and storage failure never launch additional work or apply a partial summary',async()=>{
 const {resumeSummaries,defaultSummaryOptions}=await import('../.test-build/src/orbis/manualCompaction.js')
 const {s,w}=setup(),before=structuredClone(s),options={...defaultSummaryOptions(),concurrency:1};let calls=0,saved=[]
 const c=new AbortController()
 await assert.rejects(()=>resumeSummaries(s,w,['1','2','3'],[],options,c.signal,async v=>{saved=v;c.abort()},()=>{},async()=>{calls++;return {text:'完整段',calls:[]}}))
 assert.equal(calls,1);assert.equal(saved[0],'完整段');assert.equal(saved[1],null);assert.deepEqual(s,before)
 calls=0
 await assert.rejects(()=>resumeSummaries(s,w,['1','2'],[],options,new AbortController().signal,async()=>{throw Error('存储空间不足')},()=>{},async()=>{calls++;return {text:'完整段',calls:[]}}),/存储空间不足/)
 assert.equal(calls,1);assert.deepEqual(s,before)
})
test('specific validation errors, rolling dependency, edited notes and unchanged AI limit',async()=>{
 const {resumeSummaries,defaultSummaryOptions,reviewedSegments,summaryDraftText}=await import('../.test-build/src/orbis/manualCompaction.js')
 const {s,w}=setup();const options={...defaultSummaryOptions(),concurrency:1}
 for(const [out,pattern] of [[{text:'',reasoning:'think',calls:[]},/只有|只返回了思考/],[{text:'',calls:[]},/没有返回摘要正文/],[{text:'x',calls:[{}]},/工具调用/],[{text:'a'.repeat(24001),calls:[]},/超过24,000/]]){
  await assert.rejects(()=>resumeSummaries(s,w,['1'],[],options,new AbortController().signal,async()=>{},()=>{},async()=>out),pattern)
 }
 let n=0
 const result=await resumeSummaries(s,w,['1','2'],[],{...options,mode:'rolling',concurrency:4},new AbortController().signal,async()=>{},()=>{},async(_s,win)=>{
  const data=JSON.parse(win.messages[0].text);assert.equal(data.previous_summary,n===0?'':'摘要1');return {text:'摘要'+(++n),calls:[]}
 })
 assert.equal(summaryDraftText(result,'rolling'),'摘要2')
 assert.throws(()=>reviewedSegments('随便重写没有标题',2),/保留每段/)
 const parts=reviewedSegments('【历史摘要 1】\n我修改后的事实\n\n【历史摘要 2】\n保留的约定',2)
 applyManualCompaction(s,w.id,structuredClone(w.messages),summaryDraftText(parts,'segments'),0,parts)
 assert.deepEqual(s.notes.map(n=>n.body),parts)
 const {compact}=await import('../.test-build/src/orbis/core.js')
 assert.throws(()=>compact(s,w.id,'字'.repeat(65537),0),/65,536/)
 assert.throws(()=>applyManualCompaction(s,w.id,structuredClone(w.messages),'字'.repeat(65537),0),/单份摘要上限/)
 const many=Array.from({length:4},()=> '字'.repeat(20000))
 assert.doesNotThrow(()=>applyManualCompaction(s,w.id,structuredClone(w.messages),summaryDraftText(many,'segments'),0,many))
})
