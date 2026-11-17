import test from 'node:test'
import assert from 'node:assert/strict'
import {initialState,compact} from '../.test-build/src/orbis/core.js'
function setup(t, fail=false) {
 t.mock.timers.enable({apis:['setTimeout']})
 const instances=[]
 class WorkerStub extends EventTarget {
  posted=[];terminated=false
  constructor(){super();if(fail)throw Error('disabled');instances.push(this)}
  postMessage(m){this.posted.push(m)}
  terminate(){this.terminated=true}
  emit(data){this.dispatchEvent(new MessageEvent('message',{data}))}
 }
 const original=Object.getOwnPropertyDescriptor(globalThis,'Worker')
 Object.defineProperty(globalThis,'Worker',{value:WorkerStub,configurable:true,writable:true})
 t.after(()=>{if(original)Object.defineProperty(globalThis,'Worker',original);else delete globalThis.Worker})
 const s=initialState(),w=s.windows[0]
 w.messages=[{id:'old',turn:'old',role:'user',text:'合成原文',at:1}]
 compact(s,w.id,'在海边看星星的合成约定。'.repeat(50),0)
 return {s,w,instances}
}
const load=()=>import('../.test-build/src/orbis/semantic.js?test='+crypto.randomUUID())
test('cold or stalled recall is bounded and a warm worker is retained; late results cannot enter later turns',async t=>{
 const {s,w,instances}=setup(t),{recall}=await load(),signal=new AbortController().signal
 assert.deepEqual(await recall(s,w.id,'三个字',signal),{selection:[]});assert.equal(instances.length,0)
 let done=false
 const waiting=recall(s,w.id,'四个字了',signal).then(x=>{done=true;return x})
 const worker=instances[0],oldId=worker.posted[0].id
 t.mock.timers.tick(1499);await Promise.resolve();assert.equal(done,false)
 t.mock.timers.tick(1);assert.deepEqual(await waiting,{selection:[]});assert.equal(worker.terminated,false)
 assert.deepEqual(worker.posted.at(-1),{cancel:oldId})
 worker.emit({ready:true});worker.emit({id:oldId,selection:[{id:'late'}]})
 const next=recall(s,w.id,'还记得那次约定吗',signal),id=worker.posted.at(-1).id
 worker.emit({id:oldId,selection:[{id:'late'}]});worker.emit({id,selection:[{id:'current'}]})
 assert.deepEqual((await next).selection,[{id:'current'}]);assert.equal(instances.length,1)
 t.mock.timers.tick(60000);assert.equal(worker.terminated,false)
})
test('worker startup failure degrades to keyword recall instead of rejecting the chat',async t=>{
 const {s,w}=setup(t,true),{recall}=await load()
 const r=await recall(s,w.id,'超过三个字的消息',new AbortController().signal)
 assert.deepEqual(r.selection,[]);assert.match(r.error,/无法启动/)
})
test('explicit cancellation and worker runtime failures release pending callers',async t=>{
 const {s,w,instances}=setup(t),{recall}=await load(),c=new AbortController()
 const r=recall(s,w.id,'需要停止的消息',c.signal);c.abort();assert.deepEqual(await r,{selection:[]});assert.equal(instances[0].terminated,true)
 const next=recall(s,w.id,'继续一段消息',new AbortController().signal)
 instances[1].dispatchEvent(new Event('error'));assert.deepEqual((await next).selection,[]);assert.equal(instances[1].terminated,true)
})
test('permanent initialization stalls are eventually terminated without extending chat wait',async t=>{
 const {s,w,instances}=setup(t),{recall}=await load()
 const r=recall(s,w.id,'一直未加载完成',new AbortController().signal)
 t.mock.timers.tick(1500);await r;t.mock.timers.tick(58500);assert.equal(instances[0].terminated,true)
})
