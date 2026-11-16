import { zipSync, strToU8 } from 'fflate'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
export const at = '2026-11-16T11:00:00+08:00'
export const msg = (id, parent, role, type, content) => ({ id, parent_id: parent, role, inserted_at: at, fragments: [{ type, content }] })
export function session() {
  return { id: 'synthetic-session', title: '合成 DS 分支', inserted_at: at, updated_at: at, current_message_id: 2, messages: [
    msg(1, null, 'USER', 'REQUEST', '问题原文'),
    { ...msg(2, 1, 'ASSISTANT', 'THINK', '思考原文'), fragments: [{ type: 'THINK', content: '思考原文' }, { type: 'RESPONSE', content: '当前分支回答' }, { type: 'FUTURE_TOOL', content: null, command: 'never execute' }] },
    msg(3, 1, 'ASSISTANT', 'RESPONSE', '另一分支回答'),
  ] }
}
export function v3(sessions = [session()], extra = {}, prefix = '') {
  return zipSync(Object.fromEntries(Object.entries({
    'manifest.json': strToU8(JSON.stringify({ export_format_version: 3 })),
    'chat_session_index.json': strToU8(JSON.stringify(sessions.map(s => ({ id: s.id, message_count: s.messages.length })))),
    ...Object.fromEntries(sessions.map(s => ['chat_sessions/' + s.id + '.json', strToU8(JSON.stringify(s))])),
    ...extra,
  }).map(([name, bytes]) => [prefix + name, bytes])))
}
if (process.argv[2] === '--write') {
  const dir=process.argv[3];mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'branch.zip'),v3())
  const s=session();s.title='合成长聊天';s.messages=Array.from({length:201},(_,i)=>msg(i+1,i===0?null:i,i%2===0?'USER':'ASSISTANT',i%2===0?'REQUEST':'RESPONSE','第'+(i+1)+'条合成正文'));s.current_message_id=201
  writeFileSync(join(dir,'long.zip'),v3([s]))
}
