"""Synthetic oversized chat -> HTTP 400 -> manual compaction -> continue; no paid service."""
import os,json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
URL=os.environ.get('ORBIS_TEST_URL','http://127.0.0.1:18798/orbis-web/')
OUT=Path(os.environ.get('ORBIS_TEST_OUTPUT','/tmp/axu-lite-context-actions'));OUT.mkdir(parents=True,exist_ok=True)
READ="""async()=>{const d=await new Promise(r=>{const q=indexedDB.open('orbis-web-lite-v1');q.onsuccess=()=>r(q.result)});const s=await new Promise(r=>{const q=d.transaction('state').objectStore('state').get('main');q.onsuccess=()=>r(q.result)});d.close();return s}"""
requests=[];mode=['normal'];summary_count=[0];held=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('ORBIS_CHROME'),headless=True,args=['--no-sandbox','--no-proxy-server'])
 page=b.new_page(viewport={'width':390,'height':844});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 def model(route):
  body=route.request.post_data_json;requests.append(body)
  is_summary='受人类委托整理历史聊天' in body.get('system','')
  if is_summary:
   summary_count[0]+=1
   assert body['tools']==[] and body['max_tokens']==4096
   assert len(json.dumps(body,ensure_ascii=False))<42000
   assert '超长世界书' not in body['system']
   if mode[0]=='fail': route.fulfill(status=400,content_type='application/json',body='{"error":"synthetic summary failure"}');return
   if mode[0]=='hold': held.append(route);return
   answer='合成历史总结：约好周日散步，保留重要事实与未完成待办。'
  else:
   if len(json.dumps(body,ensure_ascii=False))>90000:
    route.fulfill(status=400,content_type='application/json',body='{"error":"maximum context length exceeded; reduce the length of messages"}');return
   assert body['messages'][0]['role']=='user'
   answer='压缩后可以继续聊天了。'
  events=[{'type':'content_block_start','index':0,'content_block':{'type':'text','text':answer}},{'type':'message_delta','delta':{'stop_reason':'end_turn'}},{'type':'message_stop'}]
  route.fulfill(status=200,content_type='text/event-stream',body=''.join('data: '+json.dumps(e,ensure_ascii=False)+'\n\n' for e in events))
 page.route('https://api.deepseek.com/anthropic/v1/messages',model);page.goto(URL)
 page.get_by_role('button',name='设置',exact=True).click();page.get_by_label('API Key',exact=True).fill('synthetic-key');page.get_by_role('button',name='关闭面板').click()
 page.evaluate('''async()=>{const db=await new Promise(r=>{const q=indexedDB.open('orbis-web-lite-v1');q.onsuccess=()=>r(q.result)});const t=db.transaction('state','readwrite'),st=t.objectStore('state'),q=st.get('main');q.onsuccess=()=>{const s=q.result;s.settings.semantic=false;s.settings.autoInject=false;s.settings.preserveBranch=false;s.settings.tutorialSeen=true;s.windows[0].title='超长聊天';s.windows[0].conversation={text:'',enabled:true,world_book_text:'超长世界书',world_book_enabled:true,allowAI:false};s.windows[0].messages=Array.from({length:40},(_,i)=>({id:'old'+i,turn:'T'+Math.floor(i/2),role:i%2?'assistant':'user',text:'合成原始记录'+i+'数据'.repeat(1800),at:100000+i,status:'done'}));st.put(s,'main')};await new Promise(r=>t.oncomplete=r);db.close();dispatchEvent(new Event('orbis-change'))}''')
 page.get_by_role('textbox',name='输入消息',exact=True).fill('继续');page.get_by_role('button',name='发送消息',exact=True).click()
 expect(page.get_by_role('button',name='打开手动压缩')).to_be_visible(timeout=15000)
 originals=page.evaluate(READ)['windows'][0]['messages']
 page.get_by_role('button',name='打开手动压缩').click()
 mode[0]='fail';page.get_by_role('button',name='AI 分段生成摘要').click()
 expect(page.get_by_role('button',name='AI 分段生成摘要')).to_be_enabled(timeout=15000)
 assert page.evaluate(READ)['windows'][0]['messages']==originals
 mode[0]='hold';page.get_by_role('button',name='AI 分段生成摘要').click()
 expect(page.get_by_role('button',name='取消生成')).to_be_visible();page.get_by_role('button',name='取消生成').click()
 expect(page.get_by_role('button',name='AI 分段生成摘要')).to_be_enabled(timeout=15000)
 assert page.evaluate(READ)['windows'][0]['messages']==originals
 for route in held: route.abort()
 mode[0]='normal';before=summary_count[0];page.get_by_role('button',name='AI 分段生成摘要').click()
 expect(page.get_by_role('button',name='应用摘要并压缩')).to_be_enabled(timeout=30000)
 assert summary_count[0]-before>=6
 assert page.evaluate(READ)['windows'][0]['messages']==originals
 page.screenshot(path=str(OUT/'summary-review.png'))
 page.get_by_role('button',name='应用摘要并压缩').click()
 expect(page.get_by_text('压缩已保存；可以关闭面板继续聊天。')).to_be_visible()
 state=page.evaluate(READ);w=state['windows'][0];assert len(w['messages'])==1
 backup=next(x for x in state['windows'] if x['id']==w['compressions'][0]['backupId']);assert backup['messages']==originals
 page.get_by_role('button',name='关闭面板').click()
 page.get_by_role('textbox',name='输入消息',exact=True).fill('继续聊天');page.get_by_role('button',name='发送消息',exact=True).click()
 expect(page.locator('main')).to_contain_text('压缩后可以继续聊天了。')
 source=page.evaluate(READ)['windows'][0]
 page.get_by_role('button',name='上下文与压缩').click();page.get_by_role('button',name='从当前进度开启分支').click()
 expect(page.locator('header')).to_contain_text('分支')
 branch=page.evaluate(READ)['windows'][-1];assert len(branch['messages'])==3
 assert page.evaluate(READ)['windows'][0]==source
 page.get_by_role('textbox',name='输入消息',exact=True).fill('分支的新话');page.get_by_role('button',name='发送消息',exact=True).click()
 expect(page.locator('main .message')).to_have_count(5)
 page.wait_for_function("!document.querySelector('.typing')")
 page.reload();expect(page.locator('main')).to_contain_text('压缩后可以继续聊天了。')
 state=page.evaluate(READ);assert state['windows'][0]==source
 assert any(m['text']=='分支的新话' for m in state['windows'][-1]['messages'])
 page.get_by_role('button',name='上下文与压缩').click();page.get_by_role('button',name='撤销最近一次压缩').click()
 expect(page.get_by_role('button',name='撤销最近一次压缩')).to_be_disabled()
 state=page.evaluate(READ);assert state['windows'][0]['messages'][:len(originals)]==originals
 assert len(state['windows'][0]['messages'])==len(originals)+2
 page.screenshot(path=str(OUT/'context-mobile.png'))
 assert not errors,errors
 for width in [360,390,768,1440]:
  page.set_viewport_size({'width':width,'height':900});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
 result={'requests':len(requests),'summary_requests':summary_count[0],'oversize_400_recovered':True,'failure_cancel_unchanged':True,'summary_review_before_commit':True,'originals_preserved':True,'branch_independent':True,'reload_and_rollback':True,'widths':[360,390,768,1440],'page_errors':errors}
 (OUT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result));b.close()
