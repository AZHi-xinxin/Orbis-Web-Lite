"""Real UI/storage/runtime with stalled local worker and synthetic model responses."""
import json,os,time
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
URL=os.environ.get('ORBIS_TEST_URL','http://127.0.0.1:18799/')
OUT=Path(os.environ.get('ORBIS_TEST_OUTPUT','/tmp/lite-semantic-progress'));OUT.mkdir(parents=True,exist_ok=True)
READ="""async()=>{const d=await new Promise(r=>{const q=indexedDB.open('orbis-web-lite-v1');q.onsuccess=()=>r(q.result)});return await new Promise(r=>{const q=d.transaction('state').objectStore('state').get('main');q.onsuccess=()=>{r(q.result);d.close()}})}"""
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,args=['--no-sandbox']);page=b.new_page(viewport={'width':390,'height':844});requests=[];errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.add_init_script('''window.workerStarts=0;window.failWorker=false;window.Worker=class extends EventTarget {constructor(){super();if(window.failWorker)throw Error('blocked worker');window.workerStarts++}postMessage(){}terminate(){}};''')
 echo='[宿主消息记录时间，非正文] '+json.dumps({'at':'2026-11-17T09:19:30+08:00','time_zone':'Asia/Shanghai','unix_ms':1794878370026,'role':'assistant','event':False},ensure_ascii=False)+'\n'
 def model(route):
  body=route.request.post_data_json;requests.append(body)
  for m in body['messages']:
   if m['role']=='assistant':assert '宿主消息记录时间' not in json.dumps(m,ensure_ascii=False)
  assert '不要复述标记' in body['system']
  events=[{'type':'content_block_delta','delta':{'text':echo[:8]}},{'type':'content_block_delta','delta':{'text':echo[8:]+echo+'收到第'+str(len(requests))+'条合成消息。2026-11-17 是普通日期。'}},{'type':'message_stop'}]
  route.fulfill(status=200,content_type='text/event-stream',body=''.join('data: '+json.dumps(e,ensure_ascii=False)+'\n\n' for e in events))
 page.route('https://api.deepseek.com/anthropic/v1/messages',model);page.goto(URL);page.get_by_role('textbox',name='输入消息',exact=True).wait_for()
 page.evaluate('''async(echo)=>{const d=await new Promise(r=>{const q=indexedDB.open('orbis-web-lite-v1');q.onsuccess=()=>r(q.result)}),t=d.transaction('state','readwrite'),o=t.objectStore('state'),s=await new Promise(r=>{const q=o.get('main');q.onsuccess=()=>r(q.result)}),w=s.windows[0];w.messages=[{id:'summary',turn:'c',role:'assistant',text:'旧的合成摘要',at:1,status:'done'},{id:'echo',turn:'old',role:'assistant',text:echo+echo+'旧的合成回答',at:2,status:'done'}];w.compressions=[{id:'c',at:1,summaryId:'summary',summary:'旧的合成摘要',noteId:'n',before:100,after:10,rolledBack:false}];s.notes=[{id:'n',window:w.id,at:1,revision:1,body:'旧的合成摘要',summary:'',state:'static',tags:[],important:false,interval:1,deleted:false,history:[]}];o.put(s,'main');await new Promise(r=>t.oncomplete=r);sessionStorage.setItem('orbis-secret:api','synthetic-key')}''',echo)
 page.reload();expect(page.locator('main')).not_to_contain_text('宿主消息记录时间')
 before=page.evaluate(READ);box=page.get_by_role('textbox',name='输入消息',exact=True);send=page.get_by_role('button',name='发送消息',exact=True)
 def submit(text,n):
  start=time.monotonic();box.fill(text);send.click()
  expect(page.locator('.message.user').filter(has_text=text)).to_be_visible(timeout=1200)
  expect(page.locator('main')).to_contain_text('收到第'+str(n)+'条合成消息',timeout=5000)
  expect(page.locator('main')).not_to_contain_text('宿主消息记录时间')
  expect(page.locator('.notice').filter(has_text='本地语义')).to_have_count(0)
  return round(time.monotonic()-start,3)
 times=[submit('三个字',1),submit('四个字了',2),submit('更长的一段话，用来验证压缩后发送能够继续。'*10,3)]
 assert all(t<5 for t in times);assert len(requests)==3 and page.evaluate('workerStarts')==1
 box.fill('在检索时停止这条');send.click();expect(page.locator('.message.user').filter(has_text='在检索时停止这条')).to_be_visible(timeout=1200)
 page.get_by_role('button',name='停止 ■',exact=True).click();page.get_by_role('button',name='停止 ■',exact=True).wait_for(state='hidden');page.wait_for_timeout(1700);assert len(requests)==3
 page.evaluate('window.failWorker=true');submit('工作线程打不开也要正常发送',4);assert len(requests)==4
 state=page.evaluate(READ);assert state['notes']==before['notes'];assert state['windows'][0]['compressions']==before['windows'][0]['compressions']
 assert state['windows'][0]['messages'][:2]==before['windows'][0]['messages']
 assert '宿主消息记录时间' in state['windows'][0]['messages'][-1]['text']
 assert len([m for m in state['windows'][0]['messages'] if m['role']=='user'])==5
 page.reload();assert len(requests)==4;expect(page.locator('main')).not_to_contain_text('宿主消息记录时间');expect(page.locator('main')).to_contain_text('2026-11-17 是普通日期')
 page.screenshot(path=str(OUT/'continued.png'));assert not errors,errors
 result={'passed':True,'sendSeconds':times,'modelRequests':4,'stalledWorkerReused':True,'stopNoProviderRequest':True,'workerConstructionFailureContinues':True,'semanticFallbackSilent':True,'messagesSavedBeforeRecall':True,'rawHistoryAndMemoryPreserved':True,'oldAndStreamedEnvelopesHidden':True,'normalDatesKept':True,'reloadNoReplay':True,'pageErrors':errors}
 (OUT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(result);b.close()
