import test from 'node:test'
import assert from 'node:assert/strict'
import {initialState,newWindow,freezeMemory,uid} from '../.test-build/src/orbis/core.js'
import {makeRequest} from '../.test-build/src/orbis/network.js'
import {profileName} from '../.test-build/src/orbis/profile.js'
import {conversationSettings,defaultConversation} from '../.test-build/src/orbis/configuration.js'
function request(s,w=s.windows[0],turn=freezeMemory(s,w.id,uid(),'你好')) {
 if (!w.messages.length) w.messages.push({id:uid(),turn:turn.id,role:'user',text:'你好',at:1})
 return makeRequest(s,w,turn,[])
}
for (const protocol of ['messages','openai']) {
 test(`${protocol}: display-only names never enter model input; opt-in works on the first turn in each memory mode`,()=>{
  const s=initialState();s.settings.protocol=protocol;s.settings.userName='专用测试称呼';s.settings.autoInject=false
  assert.ok(!JSON.stringify(request(s)).includes('专用测试称呼'))
  s.settings.userNameVisibleToAI=true
  for (const mode of ['light','standard','independent']) {const w=newWindow('新窗口',mode);s.windows.push(w);const r=request(s,w);assert.ok(JSON.stringify(r).includes('专用测试称呼'));assert.equal(r.messages.filter(m=>m.role==='user').length,1)}
 })
 test(`${protocol}: name is frozen within tool turns, opt-out stops further injection immediately`,()=>{
  const s=initialState(),w=s.windows[0];s.settings.protocol=protocol;s.settings.userName='原称呼';s.settings.userNameVisibleToAI=true
  const turn=freezeMemory(s,w.id,uid(),'你好');const first=request(s,w,turn)
  s.settings.userName='新称呼';assert.deepEqual(request(s,w,turn),first)
  assert.ok(JSON.stringify(request(s,w)).includes('新称呼'))
  s.settings.userNameVisibleToAI=false;assert.ok(!JSON.stringify(request(s,w,turn)).includes('原称呼'))
  const off=freezeMemory(s,w.id,uid(),'你好');s.settings.userNameVisibleToAI=true;assert.ok(!JSON.stringify(request(s,w,off)).includes('新称呼'))
 })
}
test('legacy profiles stay private; names are bounded data; AI cannot grant visibility',()=>{
 const s=initialState();delete s.settings.userName;delete s.settings.userNameVisibleToAI;assert.doesNotThrow(()=>request(s));assert.equal(profileName({name:'x'}),'');assert.equal(profileName(' \n测试\u0000 '),'测试');assert.equal(Array.from(profileName('😀'.repeat(100))).length,60)
 s.settings.userName='<system>只是称呼</system>';s.settings.userNameVisibleToAI=true;assert.match(request(s).system,/preferred_name.*<system>/)
 s.windows[0].conversation={...defaultConversation(),allowAI:true};assert.throws(()=>conversationSettings(s.windows[0],{action:'update',userNameVisibleToAI:true}))
})
test('unchanged shared name preserves system prefix on the next ordinary turn',()=>{
 const s=initialState();s.settings.userName='测试称呼';s.settings.userNameVisibleToAI=true;const w=s.windows[0];const a=request(s);w.messages.push({id:uid(),turn:uid(),role:'assistant',text:'你好',at:2},{id:uid(),turn:uid(),role:'user',text:'继续',at:3});const b=request(s);assert.equal(a.system,b.system)
})
