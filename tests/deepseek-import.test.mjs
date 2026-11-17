import test from 'node:test'
import assert from 'node:assert/strict'
import { zipSync, strToU8 } from 'fflate'
import { LocalZip } from '../.test-build/src/orbis/localZip.js'
import { DeepSeekArchive, parseDeepSeek, appendDeepSeek } from '../.test-build/src/orbis/deepSeekImport.js'
import { initialState } from '../.test-build/src/orbis/core.js'
import { fullBackup, restoreBackup } from '../.test-build/src/orbis/backup.js'
import { at, msg, session, v3 } from './deepseek-fixtures.mjs'
import { importJson, JsonObjectArrayStream } from '../.test-build/src/orbis/importJson.js'

test('strict JSON rejects duplicate keys, trailing commas and private malformed content without leaking it', () => {
  for (const text of ['{"id":1,"id":2}', '[1,]', '{"private-secret":}', '{"x":01}', 'true false', '['.repeat(258)+'0'+']'.repeat(258)]) {
    assert.throws(()=>importJson(text), e => !e.message.includes('private-secret'))
  }
  assert.equal(importJson('{"text":"空白\\r\\n🙂","large":5.5e2}').text,'空白\r\n🙂')
  const values=[], parser=new JsonObjectArrayStream(v=>values.push(v))
  for (const char of '[ {"text":"} \\\" 🙂"}, {"second":[1,2]} ]    ') parser.push(char)
  parser.finish();assert.equal(values.length,2);assert.equal(values[0].text,'} " 🙂')
  const bad=new JsonObjectArrayStream(()=>{});assert.throws(()=>{bad.push('[{},]');bad.finish()},/格式/)
})
test('compatible future export version, absent titles, null model and changed optional tool shapes remain importable', async () => {
  const raw=session();delete raw.title;raw.messages[1].model=null
  raw.messages[1].fragments=[{type:'TOOL_FIND',content:null,results:'new shape'},{type:'FUTURE_FRAGMENT',content:{nested:true},optional:[]}]
  const archive=await DeepSeekArchive.open(new Blob([v3([raw],{'manifest.json':strToU8('{"export_format_version":4}'),'unrelated.bin':new Uint8Array([3])})]))
  assert.equal((await archive.inspect())[0].title,'未命名会话')
  const result=await archive.prepare(raw.id,'2',false)
  assert.match(result.window.messages[1].text,/new shape/);assert.match(result.window.messages[1].text,/"nested":true/)
  assert.ok(!result.window.messages[1].calls)
})
test('legacy JSON over the old 64 MiB limit streams one conversation plus trailing whitespace', async () => {
  const raw={id:'large-legacy',title:null,inserted_at:at,updated_at:at,mapping:{root:{id:'root',parent:null,children:['u'],message:null},u:{id:'u',parent:'root',children:[],message:{inserted_at:at,model:null,fragments:[{type:'REQUEST',content:'保留正文'}]}}}}
  const head=strToU8(JSON.stringify([raw])), bytes=new Uint8Array(65*1024*1024+head.length);bytes.fill(32);bytes.set(head)
  const archive=await DeepSeekArchive.open(new Blob([zipSync({'conversations.json':bytes})]));assert.equal((await archive.inspect())[0].selected,'u')
  assert.equal((await archive.prepare(raw.id,'u',false)).window.messages[0].text,'保留正文')
})

test('DS v3 selects source branch, preserves reasoning/time/unknown fragments, append deduplicates without replacing existing state', async () => {
  const s = initialState(), before = structuredClone(s), archive = await DeepSeekArchive.open(new Blob([v3()]))
  const preview = await archive.inspect()
  assert.equal(preview[0].branches.length, 2)
  assert.equal(preview[0].selected, '2')
  const a = await archive.prepare(preview[0].id, '2', false)
  assert.equal(a.window.messages.length, 2)
  assert.equal(a.window.messages[1].reasoning, '思考原文')
  assert.match(a.window.messages[1].text, /当前分支回答/)
  assert.match(a.window.messages[1].text, /FUTURE_TOOL/)
  assert.ok(!a.window.messages[1].calls)
  assert.equal(a.window.messages[1].at, Date.parse(at))
  assert.equal(appendDeepSeek(s, a.window), true)
  s.windows[1].messages[0].text += ' 本地编辑'
  assert.equal(appendDeepSeek(s, a.window), false)
  const b = await archive.prepare(preview[0].id, '3', false)
  appendDeepSeek(s, b.window)
  assert.notEqual(s.windows[1].messages[0].id, s.windows[2].messages[0].id)
  assert.deepEqual(s.windows[0], before.windows[0]); assert.deepEqual(s.settings, before.settings)
  assert.deepEqual(s.sentinels, []); assert.deepEqual(s.mcp, [])
  const restored = initialState(); restoreBackup(restored, fullBackup(s))
  assert.equal(restored.windows.at(-1).messages.at(-1).text, '另一分支回答')
})
test('changed source current branch becomes another window; empty and long messages are not truncated', async () => {
  const raw = session(); raw.title = null; raw.messages[0].fragments[0].content = '长原文'.repeat(400000)
  raw.messages[1].fragments = []
  const archive = await DeepSeekArchive.open(new Blob([v3([raw])]))
  const preview = await archive.inspect(); assert.equal(preview[0].title, '未命名会话')
  const x = await archive.prepare(raw.id, '2', false); assert.equal(x.window.messages[0].text, raw.messages[0].fragments[0].content)
  assert.equal(x.window.messages[1].text, '')
  const s = initialState(); appendDeepSeek(s, x.window)
  raw.messages[1].fragments = [{ type: 'RESPONSE', content: '补全' }]
  const next = await (await DeepSeekArchive.open(new Blob([v3([raw])]))).prepare(raw.id, '2', false)
  assert.equal(appendDeepSeek(s, next.window), true); assert.notEqual(s.windows[1].id, s.windows[2].id)
})
test('media is local and optional, unknown documents keep references; borrowed chat paths are rejected', async () => {
  const raw = session(), path = `chat_sessions/${raw.id}_files/one.png`, bytes = Uint8Array.from([137,80,78,71,13,10,26,10])
  const ref = { id: 'file1', file_name: 'one.png', file_size: bytes.length, export_path: path }
  raw.messages[0].fragments.push({ type: 'FILE', files: [ref, { id: 'missing', file_name: 'missing.pdf', export_path: null }] })
  const archive = await DeepSeekArchive.open(new Blob([v3([raw], { [path]: bytes }, 'export/')]))
  const plain = await archive.prepare(raw.id, '2', false); assert.equal(plain.restored, 0); assert.equal(plain.attachments, 2)
  assert.match(plain.window.messages[0].text, /one.png/)
  const media = await archive.prepare(raw.id, '2', true); assert.equal(media.restored, 1)
  assert.equal(media.window.messages[0].files[0].data, 'data:image/png;base64,' + Buffer.from(bytes).toString('base64'))
  assert.match(media.window.messages[0].text, /missing.pdf/)
  ref.export_path = 'chat_sessions/another_files/one.png'
  const bad = await DeepSeekArchive.open(new Blob([v3([raw])]))
  await assert.rejects(() => bad.inspect(), /结构/)
})
test('legacy mapping ZIP retains newest leaf and explicit older branch; cycle and missing nodes rejected', async () => {
  const legacy = { id: 'legacy', title: '旧版', inserted_at: at, updated_at: at, mapping: {
    root: { id: 'root', parent: null, children: ['u'], message: null },
    u: { id: 'u', parent: 'root', children: ['a'], message: { inserted_at: at, fragments: [{ type: 'REQUEST', content: '原文' }] } },
    a: { id: 'a', parent: 'u', children: [], message: { inserted_at: at, fragments: [{ type: 'THINK', content: '思考' }, { type: 'RESPONSE', content: '回复' }] } },
  } }
  const archive = await DeepSeekArchive.open(new Blob([zipSync({ 'export/conversations.json': strToU8(JSON.stringify([legacy])) })]))
  assert.equal((await archive.inspect())[0].selected, 'a')
  assert.deepEqual((await archive.prepare('legacy','a',false)).window.messages.map(m=>m.role), ['user','assistant'])
  legacy.current_node = 'u'; assert.equal(parseDeepSeek(legacy).selected, 'u')
  legacy.mapping.u.children=[]; assert.throws(()=>parseDeepSeek(legacy), /结构/)
  const raw=session();raw.messages[0].parent_id=2;assert.throws(()=>parseDeepSeek(raw), /结构/)
})
test('large archive uses slices, never whole-file allocation or irrelevant attachment reads', async () => {
  const bytes = v3(), d = new DataView(bytes.buffer), end = bytes.length-22, directory = d.getUint32(end+16,true), pad = 200*1024*1024
  for(let p=directory;p<end;){ d.setUint32(p+42,d.getUint32(p+42,true)+pad,true);p+=46+d.getUint16(p+28,true)+d.getUint16(p+30,true)+d.getUint16(p+32,true) }
  d.setUint32(end+16,directory+pad,true)
  class TrackedBlob extends Blob {
    read = 0
    async arrayBuffer(){throw Error('Whole-file read forbidden')}
    slice(start,end){this.read+=(end??this.size)-(start??0);return super.slice(start,end)}
  }
  const padding = new Uint8Array(1024*1024), blob = new TrackedBlob([...Array(200).fill(padding),bytes])
  const archive = await DeepSeekArchive.open(blob); assert.equal((await archive.inspect()).length,1)
  await archive.prepare('synthetic-session','2',false); assert.ok(blob.read<100000,blob.read)
})
test('CRC corruption, duplicate paths, bad count and expansion limits fail before import', async () => {
  const bytes=zipSync({'manifest.json': [strToU8('{"test":1}'),{level:0}]}), d=new DataView(bytes.buffer)
  bytes[30+d.getUint16(26,true)+d.getUint16(28,true)]^=1
  const zip=await LocalZip.open(new Blob([bytes]));await assert.rejects(()=>zip.read('manifest.json'),/校验/)
  const valid=await LocalZip.open(new Blob([v3()]));await assert.rejects(()=>valid.read('manifest.json',1),/超过/)
  await assert.rejects(()=>LocalZip.open(new Blob([zipSync({'../bad':strToU8('x')})])),/路径/)
  const raw=session(), bad=await DeepSeekArchive.open(new Blob([v3([raw],{'chat_session_index.json':strToU8(JSON.stringify([{id:raw.id,message_count:99}]))})]))
  await assert.rejects(()=>bad.inspect(),/结构/)
  const duplicate=v3();const view=new DataView(duplicate.buffer);const e=duplicate.length-22;const dir=view.getUint32(e+16,true);const firstSize=46+view.getUint16(dir+28,true)+view.getUint16(dir+30,true)+view.getUint16(dir+32,true)
  const central=duplicate.slice(dir,dir+firstSize), body=new Uint8Array(duplicate.length+firstSize);body.set(duplicate.slice(0,e));body.set(central,e);body.set(duplicate.slice(e),e+firstSize)
  const v=new DataView(body.buffer), ee=e+firstSize;v.setUint16(ee+8,v.getUint16(ee+8,true)+1,true);v.setUint16(ee+10,v.getUint16(ee+10,true)+1,true);v.setUint32(ee+12,v.getUint32(ee+12,true)+firstSize,true)
  await assert.rejects(()=>LocalZip.open(new Blob([body])),/重复/)
})

test('missing index, missing times and file metadata recover locally with warnings and full-backup roundtrip', async () => {
  const raw=session();delete raw.inserted_at;delete raw.updated_at;delete raw.messages[0].inserted_at
  raw.pinned=true;raw.messages[1].inserted_at='invalid';raw.messages[1].fragments[0].elapsed_secs=2.5
  raw.messages[1].fragments.push({type:'TOOL_SEARCH',status:'FINISHED',results:[{url:'https://example.invalid/no-fetch',title:'Synthetic source'}]})
  const path=`chat_sessions/${raw.id}_files/report.pdf`, bytes=strToU8('%PDF-synthetic')
  raw.messages[0].fragments.push({type:'FILE',files:[{file_name:'report.pdf',export_path:path}]})
  const archive=await DeepSeekArchive.open(new Blob([zipSync({
    '导出/manifest.json':strToU8('{"export_format_version":3}'),
    [`导出/chat_sessions/${raw.id}.json`]:strToU8(JSON.stringify(raw)),
    ['导出/'+path]:bytes,
  })]))
  const preview=(await archive.inspect())[0]
  assert.equal(preview.selected,'2');assert.equal(preview.warnings.length,2)
  const {window:w,restored}=await archive.prepare(raw.id,'2',true)
  assert.equal(restored,1);assert.equal(w.pinned,true);assert.ok(w.messages.every(m=>m.sourceTimeUnknown))
  assert.equal(w.messages[1].sourceTimestamp,'"invalid"');assert.equal(w.messages[1].reasoningMs,2500)
  assert.ok(!w.messages[1].elapsedMs);assert.ok(!w.messages[1].calls);assert.equal(w.messages[1].importHistory.length,1)
  assert.equal(w.messages[0].files[0].mime,'application/pdf')
  const state=initialState();appendDeepSeek(state,w);const restoredState=initialState();restoreBackup(restoredState,fullBackup(state))
  assert.deepEqual(restoredState.windows.at(-1).messages,state.windows.at(-1).messages)
  assert.equal(restoredState.windows.at(-1).pinned,true)
  const { messageTimestamp } = await import('../.test-build/src/orbis/clock.js')
  assert.equal(messageTimestamp(w.messages[0]),'[导入记录：原消息时间未知]\n')
  const { universalChat } = await import('../.test-build/src/orbis/backup.js')
  assert.ok(!universalChat(state).conversations.at(-1).messages[0].timestamp)
})
test('existing corrupt index, conflicting export roots and declared bad size still reject', async () => {
  const raw=session(), contents={ 'manifest.json':strToU8('{"export_format_version":3}'), [`chat_sessions/${raw.id}.json`]:strToU8(JSON.stringify(raw)) }
  await assert.rejects(()=>DeepSeekArchive.open(new Blob([zipSync({...contents,'chat_session_index.json':strToU8('{invalid}')} )])))
  await assert.rejects(()=>DeepSeekArchive.open(new Blob([zipSync({...contents,...Object.fromEntries(Object.entries(contents).map(([k,v])=>['other/'+k,v]))})])))
  const path=`chat_sessions/${raw.id}_files/bad.txt`
  raw.messages[0].fragments.push({type:'FILE',files:[{file_name:'bad.txt',export_path:path,file_size:99}]})
  const archive=await DeepSeekArchive.open(new Blob([v3([raw],{[path]:strToU8('short')})]))
  await assert.rejects(()=>archive.inspect())
})
