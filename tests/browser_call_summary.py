"""Isolated summary failure/retry and refresh behavior, synthetic model only."""
import json,os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
OUT=Path(os.environ.get('ORBIS_TEST_OUTPUT','/tmp/lite-summary'));OUT.mkdir(parents=True,exist_ok=True)
URL=os.environ.get('ORBIS_TEST_URL','http://127.0.0.1:18792/orbis-web/')
requests=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/home/xinxin/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',headless=True,args=['--no-sandbox','--no-proxy-server'])
 page=b.new_page(viewport={'width':390,'height':844});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 def model(route):
  body=route.request.post_data_json;requests.append(body);assert not body.get('tools')
  if len(requests)==1:route.fulfill(status=503,json={'error':{'message':'synthetic unavailable'}})
  else:route.fulfill(status=200,content_type='text/event-stream',body='data: '+json.dumps({'type':'content_block_start','index':0,'content_block':{'type':'text','text':'我们约定周日散步。'}},ensure_ascii=False)+'\n\ndata: {"type":"message_stop"}\n\n')
 page.route('https://api.deepseek.com/anthropic/v1/messages',model);page.goto(URL)
 page.get_by_role('button',name='设置',exact=True).click();page.get_by_label('API Key',exact=True).fill('synthetic-key');page.get_by_label('在此设备保存密钥',exact=True).check();page.get_by_role('button',name='关闭面板').click()
 page.evaluate('''async()=>{const db=await new Promise(r=>{const q=indexedDB.open('orbis-web-lite-v1');q.onsuccess=()=>r(q.result)});const tx=db.transaction('state','readwrite'),st=tx.objectStore('state'),q=st.get('main');q.onsuccess=()=>{const s=q.result,w=s.windows[0],at=Date.now()-60000;w.messages=[{id:'raw',turn:'t',role:'user',text:'周日散步',at:at+1000,voiceSessionId:'interrupted'}];w.voiceSessions=[{id:'interrupted',startedAt:at,status:'active',summaryStatus:'pending'}];st.put(s,'main')};await new Promise(r=>tx.oncomplete=r);db.close();dispatchEvent(new Event('orbis-change'))}''')
 expect(page.locator('.voice-call-card')).to_contain_text('通话未正常结束');assert not requests
 page.get_by_role('button',name='结束并整理记录').click();expect(page.locator('.voice-call-card')).to_contain_text('总结未完成',timeout=15000);assert len(requests)==1
 page.reload();expect(page.locator('.voice-call-card')).to_contain_text('总结未完成');assert len(requests)==1
 page.get_by_role('button',name='重新总结').click();expect(page.locator('.voice-call-card')).to_contain_text('已归档',timeout=15000);assert len(requests)==2
 page.get_by_role('button',name='查看完整记录').click();expect(page.get_by_role('dialog',name='完整通话记录')).to_contain_text('周日散步')
 page.get_by_role('button',name='关闭通话记录').click();page.emulate_media(color_scheme='dark');page.screenshot(path=str(OUT/'call-ended-dark.png'))
 assert not errors,errors;(OUT/'result.json').write_text(json.dumps({'passed':True,'requests':len(requests),'errors':errors,'checks':['interrupted call remains available','manual finish','503 preserves raw','no retry after refresh','explicit retry succeeds','dark history']},ensure_ascii=False,indent=2));b.close()
