"""Runs the real bundled ONNX model; only the conversational provider is synthetic."""
import json,time,os
from pathlib import Path
from playwright.sync_api import sync_playwright
OUT=Path(os.environ.get('ORBIS_TEST_OUTPUT','/tmp/orbis-web-browser-tests'));OUT.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('ORBIS_CHROME'),headless=True,args=['--no-sandbox'])
 ctx=b.new_context(viewport={'width':390,'height':844});page=ctx.new_page();errors=[];requests=[];assets=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('request',lambda r:assets.append(r.url))
 def route(r):
  requests.append(r.request.post_data_json)
  r.fulfill(status=200,content_type='text/event-stream',body='data: '+json.dumps({'type':'content_block_delta','delta':{'text':'读到了本地记忆。'}},ensure_ascii=False)+'\n\ndata: {"type":"message_stop"}\n\n')
 page.route('https://api.deepseek.com/anthropic/v1/messages',route)
 page.goto(os.environ.get('ORBIS_TEST_URL','http://127.0.0.1:18791'));page.get_by_role('textbox',name='输入消息',exact=True).wait_for()
 page.evaluate('''async()=>{const d=await new Promise((res,rej)=>{const r=indexedDB.open('orbis-web-lite-v1');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});const tx=d.transaction('state','readwrite');const s=await new Promise(res=>{const r=tx.objectStore('state').get('main');r.onsuccess=()=>res(r.result)});s.windows.push({id:'old-window',title:'以前的约定',mode:'standard',at:1,messages:[],compressions:[{id:'compact-fixture',at:1,summaryId:'summary',summary:'我们曾约定在夏天去海边一起看星星和流星。',noteId:'note-fixture',before:10,after:5,rolledBack:false}]});s.notes.push({id:'note-fixture',window:'old-window',at:1,revision:1,body:'我们曾约定在夏天去海边一起看星星和流星。',summary:'',state:'static',tags:[],important:false,interval:1,deleted:false,history:[]});s.revision++;tx.objectStore('state').put(s,'main');await new Promise(res=>tx.oncomplete=res);sessionStorage.setItem('orbis-secret:api','synthetic-not-a-key')}''')
 page.reload();page.get_by_role('textbox',name='输入消息',exact=True).fill('你还记得我们夏天在海边看星星的约定吗？');start=time.monotonic();page.get_by_role('button',name='发送消息',exact=True).click();page.wait_for_function("!document.querySelector('.typing') && document.body.innerText.includes('读到了本地记忆。')",timeout=60000)
 elapsed=time.monotonic()-start
 assert requests,'No model request'
 payload=json.dumps(requests[-1],ensure_ascii=False)
 assert 'semantic' in payload and '我们曾约定' in payload, (payload,page.locator('body').inner_text())
 assert not errors,errors
 result={'passed':True,'elapsed_seconds':round(elapsed,3),'actual_model_loaded':any('model.onnx' in x for x in assets),'wasm_loaded':any('.wasm' in x for x in assets),'external_embedding_service':False,'page_errors':errors}
 (OUT/'semantic-browser-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(result);b.close()
