import test from 'node:test'
import assert from 'node:assert/strict'
import { captureClock, localTimestamp, clockReading } from '../.test-build/src/orbis/clock.js'
import { initialState, freezeMemory, sentinelAction, claimSentinels } from '../.test-build/src/orbis/core.js'
import { makeRequest, enabledTools } from '../.test-build/src/orbis/network.js'
const msg=(id,role,text,at,rest={})=>({id,role,text,at,turn:'turn-'+id,...rest})
test('local dates, offsets and Unix time follow the device zone including midnight and DST',()=>{
 const at=Date.parse('2026-11-16T00:30:00Z')
 assert.equal(localTimestamp(at,'Asia/Shanghai'),'2026-11-16T08:30:00+08:00')
 assert.equal(localTimestamp(at,'America/Los_Angeles'),'2026-11-15T16:30:00-08:00')
 assert.equal(localTimestamp(Date.parse('2026-07-01T00:30:00Z'),'America/Los_Angeles'),'2026-06-30T17:30:00-07:00')
 assert.equal(clockReading(captureClock(at,'Asia/Shanghai')).unix_ms,at)
 assert.equal(localTimestamp(NaN,'UTC'),'时间未知')
})
for(const protocol of ['messages','openai'])test(`${protocol}: time metadata preserves historical request prefixes across turns, clock and timezone changes`,t=>{
 const s=initialState(),w=s.windows[0];s.settings.protocol=protocol;s.settings.threshold=0;s.settings.autoInject=false
 const at=Date.parse('2026-11-16T10:30:00Z')
 const signed=[{type:'thinking',thinking:'合成思考',signature:'keep-exact'},{type:'tool_use',name:'orbis_time',id:'clock-call',input:{}}]
 w.messages=[msg('old','user','旧消息',at-120000),msg('u','user','你好',at-90000,{timeZone:'Asia/Shanghai'}),msg('a','assistant','',at-80000,{timeZone:'Asia/Shanghai',calls:[{id:'clock-call',name:'orbis_time',arguments:'{}'}],thinkingBlocks:[signed[0]]}),msg('t','tool','{"ok":true}',at-70000,{callId:'clock-call'}),msg('answer','assistant','回答',at-60000,{timeZone:'Asia/Shanghai'}),msg('u2','user','现在几点',at,{timeZone:'Asia/Shanghai'})]
 const before=structuredClone(w.messages),turn=freezeMemory(s,w.id,'current','现在几点')
 const req=makeRequest(s,w,turn,[]),text=JSON.stringify(req)
 for(const m of w.messages.filter(m=>m.role!=='tool'))assert.ok(text.includes(localTimestamp(m.at,m.timeZone??'UTC')))
 assert.match(text,/Asia\/Shanghai/);assert.deepEqual(w.messages,before)
 assert.equal(text.includes('keep-exact'),protocol==='messages')
 if(protocol==='messages'){
  const tool=req.messages.flatMap(m=>m.content).find(x=>x.type==='tool_result');assert.equal(tool.content,'{"ok":true}')
  assert.deepEqual(req.messages.find(m=>m.role==='assistant').content[0],signed[0])
 }else assert.equal(req.messages.find(m=>m.role==='tool').content,'{"ok":true}')
 t.mock.method(Date,'now',()=>at+600000)
 assert.deepEqual(makeRequest(s,w,turn,[]),req)
 w.messages.push(msg('next-a','assistant','稍后回复',at+500000,{timeZone:'Asia/Shanghai'}),msg('next-u','user','我已换时区',at+600000,{timeZone:'America/Los_Angeles'}))
 const later=freezeMemory(s,w.id,'later','我已换时区'),req2=makeRequest(s,w,later,[])
 assert.equal(req2.system??req2.messages[0].content,req.system??req.messages[0].content)
 assert.deepEqual(req2.messages.slice(0,req.messages.length),req.messages)
 assert.match(JSON.stringify(req2),/02:40:00-08:00/)
 assert.ok(enabledTools(s).some(t=>t.name==='orbis_time'))
 assert.equal(clockReading().unix_ms,at+600000)
})
test('only human master permission enables AI rule creation; toggling creates no rule and disabled rules never fire',()=>{
 const s=initialState(),w=s.windows[0],args={action:'create',type:'once',name:'合成规则',prompt:'AI 自己的安排',due_at_ms:Date.now()+60000,timezone:'Asia/Shanghai'}
 assert.equal(s.settings.sentinelEnabled,false);assert.equal(s.sentinels.length,0)
 assert.equal(enabledTools(s).some(t=>t.name==='orbis_sentinel'),false)
 assert.throws(()=>sentinelAction(s,w.id,{...args,master_enabled:true}),/人类尚未开启/)
 assert.equal(s.settings.sentinelEnabled,false)
 s.settings.sentinelEnabled=true;assert.equal(s.sentinels.length,0)
 const result=sentinelAction(s,w.id,args);assert.equal(result.saved,true);assert.equal(result.rule.window,w.id)
 s.settings.sentinelEnabled=false;assert.deepEqual(claimSentinels(s,args.due_at_ms),[]);assert.equal(s.sentinels.length,1)
 assert.throws(()=>sentinelAction(s,w.id,{action:'resume',id:result.rule.id}),/人类尚未开启/)
 s.settings.sentinelEnabled=true;assert.equal(claimSentinels(s,args.due_at_ms).length,1);assert.equal(claimSentinels(s,args.due_at_ms).length,0)
})
test('message timestamps survive full backup, missing historical timezone remains UTC',async()=>{
 const {fullBackup,restoreBackup}=await import('../.test-build/src/orbis/backup.js')
 const s=initialState(),w=s.windows[0];w.messages=[msg('history','user','过去的一句话',1234567890),msg('recent','assistant','你好',Date.parse('2026-11-16T10:30:00Z'),{timeZone:'Asia/Shanghai'})]
 const turn=freezeMemory(s,w.id,'save-clock','now')
 const target=initialState();restoreBackup(target,fullBackup(s));assert.deepEqual(target.windows.find(x=>x.id===w.id).messages,w.messages)
 assert.match(JSON.stringify(makeRequest(s,w,turn,[])),/1970-01-15T06:56:07Z/)
 assert.equal(clockReading({at:Date.now(),timeZone:'invalid/zone'}).time_zone,'UTC')
})
