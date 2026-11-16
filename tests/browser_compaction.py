"""Real IndexedDB/runtime with strict synthetic Messages service; no real account or memory."""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
URL=os.environ.get('ORBIS_TEST_URL','http://127.0.0.1:18794/orbis-web/')
OUT=Path(os.environ.get('ORBIS_TEST_OUTPUT','/tmp/axu-lite-alpha8-compaction'));OUT.mkdir(parents=True,exist_ok=True)
requests=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('ORBIS_CHROME'),headless=True,args=['--no-sandbox','--no-proxy-server'])
 page=b.new_page(viewport={'width':390,'height':844});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 def model(route):
  body=route.request.post_data_json;requests.append(body)
  assert body['messages'][0]['role']=='user', 'reproduced original assistant-first 400'
  tool_results=[x for m in body['messages'] for x in m['content'] if x['type']=='tool_result']
  if not tool_results: block={'type':'tool_use','id':'saved-memory','name':'orbis_memory','input':{'action':'save','body':'合成约定：星期日散步','state':'static'}}
  elif len(tool_results)==1: block={'type':'tool_use','id':'compact-now','name':'compact','input':{'summary':'之前进行了合成聊天，并约好星期日散步。','keep_recent':0}}
  else:
   assert '宿主提供的历史上下文说明' in body['messages'][0]['content'][0]['text']
   assert [x['tool_use_id'] for x in tool_results]==['saved-memory','compact-now']
   assert all('error' not in json.loads(x['content']) for x in tool_results)
   block={'type':'text','text':'记忆已保存，压缩完成，继续聊天正常。'}
  events=[{'type':'content_block_start','index':0,'content_block':block},{'type':'message_stop'}]
  route.fulfill(status=200,content_type='text/event-stream',body=''.join('data: '+json.dumps(x,ensure_ascii=False)+'\n\n' for x in events))
 page.route('https://api.deepseek.com/anthropic/v1/messages',model);page.goto(URL)
 page.get_by_role('button',name='设置',exact=True).click();page.get_by_label('API Key',exact=True).fill('synthetic-key');page.get_by_role('button',name='关闭面板').click()
 page.evaluate('''async()=>{const db=await new Promise(r=>{const q=indexedDB.open('orbis-web-lite-v1');q.onsuccess=()=>r(q.result)});const t=db.transaction('state','readwrite'),st=t.objectStore('state'),q=st.get('main');q.onsuccess=()=>{const s=q.result;s.settings.semantic=false;s.settings.autoInject=false;s.windows[0].messages=Array.from({length:6},(_,i)=>({id:'old'+i,turn:'oldturn'+Math.floor(i/2),role:i%2?'assistant':'user',text:'原始合成历史'+i,at:Date.now()-60000+i,status:'done'}));st.put(s,'main')};await new Promise(r=>t.oncomplete=r);db.close();dispatchEvent(new Event('orbis-change'))}''')
 page.get_by_role('textbox',name='输入消息',exact=True).fill('请记住约定，压缩后继续。');page.get_by_role('button',name='发送消息',exact=True).click()
 expect(page.locator('main')).to_contain_text('记忆已保存，压缩完成，继续聊天正常。',timeout=20000)
 state=page.evaluate('''async()=>{const db=await new Promise(r=>{const q=indexedDB.open('orbis-web-lite-v1');q.onsuccess=()=>r(q.result)});return await new Promise(r=>{const q=db.transaction('state').objectStore('state').get('main');q.onsuccess=()=>{r(q.result);db.close()}})}''')
 w=state['windows'][0];assert len(w['compressions'])==1 and len(requests)==3
 assert any(n['body']=='合成约定：星期日散步' for n in state['notes'])
 backup=next(x for x in state['windows'] if x['id']==w['compressions'][0]['backupId'])
 assert [m['text'] for m in backup['messages'][:6]]==['原始合成历史'+str(i) for i in range(6)]
 assert w['messages'][0]['role']=='assistant' and '压缩摘要' in w['messages'][0]['text']
 assert all('宿主提供的历史上下文说明' not in m['text'] for m in w['messages'])
 page.screenshot(path=str(OUT/'compacted.png'));page.reload();expect(page.locator('main')).to_contain_text('记忆已保存，压缩完成，继续聊天正常。');assert len(requests)==3
 assert not errors,errors
 (OUT/'result.json').write_text(json.dumps({'requests':len(requests),'strict_user_first':True,'memory_saved':True,'originals_preserved':True,'reload_no_replay':True,'page_errors':errors},ensure_ascii=False,indent=2));b.close()
