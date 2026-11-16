import test from 'node:test'
import assert from 'node:assert/strict'
import { initialState, uid, freezeMemory, compact, rollback, memoryAction } from '../.test-build/src/orbis/core.js'
import { makeRequest } from '../.test-build/src/orbis/network.js'
const message = (role, text, turn = uid(), rest = {}) => ({id:uid(),role,text,turn,at:Date.now(),...rest})
for (const protocol of ['messages','openai']) {
  test(`${protocol}: memory save then compaction continues with a user-first history and intact tool pairs`, () => {
    const s=initialState(), w=s.windows[0];s.settings.protocol=protocol
    w.messages=[message('user','旧问题'),message('assistant','旧答案')]
    const turn='active';w.messages.push(message('user','存下约定再压缩',turn))
    const frozen=freezeMemory(s,w.id,turn,'存下约定再压缩')
    const note=memoryAction(s,w.id,{action:'save',body:'约好星期日散步',state:'static'})
    w.messages.push(message('assistant','',turn,{calls:[{id:'memory',name:'orbis_memory',arguments:'{}'}]}),message('tool',JSON.stringify(note),turn,{callId:'memory'}))
    w.messages.push(message('assistant','',turn,{calls:[{id:'compress',name:'compact',arguments:'{}'}]}))
    const original=structuredClone(w.messages), event=compact(s,w.id,'此前约好星期日散步',0,turn)
    w.messages.push(message('tool',JSON.stringify(event),turn,{callId:'compress'}))
    const saved=JSON.stringify(w.messages),request=makeRequest(s,w,frozen,[])
    const messages=request.messages.filter(m=>m.role!=='system')
    assert.equal(messages[0].role,'user')
    assert.match(JSON.stringify(messages[0]),/不是人类新发言/)
    assert.equal(messages[1].role,'assistant')
    assert.match(JSON.stringify(messages[1]),/此前约好星期日散步/)
    assert.equal(messages.at(-1).role,protocol==='messages'?'user':'tool')
    const serialized=JSON.stringify(messages)
    assert.match(serialized,/memory/);assert.match(serialized,/compress/)
    assert.equal(JSON.stringify(w.messages),saved)
    assert.deepEqual(s.windows.find(x=>x.id===event.backupId).messages,original)
    assert.equal(s.notes.some(n=>n.body==='约好星期日散步'),true)
    rollback(s,w.id)
    const restored=makeRequest(s,w,frozen,[])
    assert.doesNotMatch(JSON.stringify(restored),/宿主提供的历史上下文说明/)
    assert.match(JSON.stringify(restored),/旧问题/)
  })
}
test('normal conversation stays byte-identical in roles; old saved summary is repaired only at serialization',()=>{
  const s=initialState(),w=s.windows[0];w.messages=[message('user','你好'),message('assistant','你好')]
  const turn=freezeMemory(s,w.id,'next','你好')
  assert.deepEqual(makeRequest(s,w,turn,[]).messages.map(m=>m.role),['user','assistant'])
  w.messages.unshift(message('assistant','[之前对话的压缩摘要，不是逐字原文]\n旧版本存档'))
  const before=structuredClone(w.messages)
  assert.equal(makeRequest(s,w,turn,[]).messages[0].role,'user')
  assert.deepEqual(w.messages,before)
})
