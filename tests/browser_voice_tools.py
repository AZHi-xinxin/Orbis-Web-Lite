"""All model/ASR/TTS traffic is synthetic; real browser audio lifecycle and IDB."""
import io,json,os,wave
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
OUT=Path(os.environ.get('ORBIS_TEST_OUTPUT','/tmp/orbis-alpha6-browser'));OUT.mkdir(parents=True,exist_ok=True)
URL=os.environ.get('ORBIS_TEST_URL','http://127.0.0.1:18791/orbis-web/')
requests=[];speech=[]
def model(route):
 body=route.request.post_data_json;requests.append(body)
 last=body['messages'][-1]['content']
 if last and last[-1].get('type')=='tool_result':
  blocks=[{'type':'text','text':'合成开场白。'}]
 else:
  text=''.join(x.get('text','') for x in last)
  tool='orbis_voice_note' if '请发语音条' in text else 'start_voice_call' if '请来电' in text else 'end_voice_call' if '合成挂断' in text else None
  if tool:
   assert any(t.get('name')==tool for t in body['tools']),tool
   args={'text':'保存下来的合成语音。'} if tool=='orbis_voice_note' else {'reason':'合成来电邀请','max_ring_seconds':5} if tool=='start_voice_call' else {}
   blocks=[{'type':'tool_use','name':tool,'id':'tool-'+str(len(requests)),'input':args}]
  else:blocks=[{'type':'text','text':'普通文字回复。'}]
 events=[{'type':'content_block_start','index':i,'content_block':b} for i,b in enumerate(blocks)]+[{'type':'message_stop'}]
 route.fulfill(status=200,content_type='text/event-stream',body=''.join('data: '+json.dumps(e,ensure_ascii=False)+'\n\n' for e in events))
def tts(route):
 speech.append('tts');assert route.request.headers['authorization']=='Bearer synthetic-key'
 f=io.BytesIO()
 with wave.open(f,'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(24000);w.writeframes(b'\0\0'*4800)
 route.fulfill(status=200,content_type='audio/wav',body=f.getvalue())
def asr(route):
 speech.append('asr');route.fulfill(status=200,json={'text':'合成挂断','duration_ms':500})
READ="""async()=>{const d=await new Promise((r,j)=>{const q=indexedDB.open('orbis-web-lite-v1');q.onsuccess=()=>r(q.result);q.onerror=j});return await new Promise((r,j)=>{const q=d.transaction('state').objectStore('state').get('main');q.onsuccess=()=>{r(q.result);d.close()};q.onerror=j})}"""
RESET="""async()=>{const d=await new Promise(r=>{const q=indexedDB.open('orbis-web-lite-v1');q.onsuccess=()=>r(q.result)});const t=d.transaction('state','readwrite'),s=t.objectStore('state'),q=s.get('main');q.onsuccess=()=>{q.result.settings.incomingCallCooldownUntil=0;s.put(q.result,'main')};await new Promise(r=>t.oncomplete=r);d.close();dispatchEvent(new Event('orbis-change'))}"""
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/home/xinxin/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',headless=True,args=['--no-sandbox','--no-proxy-server','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required'])
 ctx=b.new_context(viewport={'width':390,'height':844},permissions=['microphone'])
 ctx.route('https://api.deepseek.com/anthropic/v1/messages',model);ctx.route('https://api.deepseek.com/v1/tools/tts',tts);ctx.route('https://api.deepseek.com/v1/tools/asr',asr)
 ctx.add_init_script("""window.micRequests=0;window.micStreams=[];const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async(...a)=>{window.micRequests++;const s=await original(...a);window.micStreams.push(s);return s}""")
 page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto(URL)
 def settings():page.get_by_role('button',name='设置',exact=True).click()
 def send(text):
  page.get_by_role('textbox',name='输入消息',exact=True).fill(text);page.get_by_role('button',name='发送消息',exact=True).click()
 def done():page.get_by_role('button',name='停止 ■',exact=True).wait_for(state='hidden',timeout=20000)
 settings();page.get_by_label('API Key',exact=True).fill('synthetic-key');page.get_by_label('在此设备保存密钥',exact=True).check();page.get_by_label('回复朗读服务',exact=True).select_option('deepseek')
 expect(page.get_by_label('允许 AI 发语音条',exact=True)).not_to_be_checked();expect(page.get_by_label('允许 AI 来电',exact=True)).not_to_be_checked()
 page.get_by_label('允许 AI 发语音条',exact=True).check();page.get_by_label('允许 AI 来电',exact=True).check();page.get_by_role('button',name='关闭面板').click()
 for width in [320,390,768,1280]:
  page.set_viewport_size({'width':width,'height':844})
  tops=page.locator('.composer-tools button').evaluate_all('(xs)=>xs.map(x=>x.getBoundingClientRect().top)')
  assert max(tops)-min(tops)<2,(width,tops)
  assert not page.evaluate('document.documentElement.scrollWidth>innerWidth'),width
 page.set_viewport_size({'width':390,'height':844})
 # Hide/show human thought without discarding its draft; compact mode retains only input/send.
 page.get_by_role('button',name='人类思考链',exact=True).click()
 page.get_by_role('textbox',name='人类思考链',exact=True).fill('不发送的草稿')
 page.get_by_role('button',name='关闭人类思考链',exact=True).click();expect(page.get_by_role('textbox',name='人类思考链',exact=True)).to_have_count(0)
 page.get_by_role('button',name='人类思考链',exact=True).click();expect(page.get_by_role('textbox',name='人类思考链',exact=True)).to_have_value('不发送的草稿')
 page.get_by_role('button',name='关闭人类思考链',exact=True).click()
 page.screenshot(path=str(OUT/'expanded.png'));page.get_by_role('button',name='收起输入工具',exact=True).click();expect(page.locator('.composer-tools')).to_have_count(0)
 assert page.locator('.composer').bounding_box()['height']<90
 page.screenshot(path=str(OUT/'collapsed.png'));page.reload();expect(page.locator('.composer-tools')).to_have_count(0);page.get_by_role('button',name='展开输入工具',exact=True).click()
 send('请发语音条');done();expect(page.locator('audio')).to_have_count(1)
 assert page.locator('audio').evaluate('(x)=>x.paused&&!x.autoplay');assert speech==['tts']
 state=page.evaluate(READ);notes=[m for w in state['windows'] for m in w['messages'] if m.get('voiceNote')];assert len(notes)==1;assert notes[0]['files'][0]['data'].startswith('data:audio/wav;base64,')
 page.reload();expect(page.locator('audio')).to_have_count(1);page.locator('audio').evaluate('(x)=>x.play()');page.wait_for_timeout(300)
 # A rejected call never requests the microphone and imposes cooldown.
 send('请来电，测试拒绝');expect(page.get_by_role('dialog',name='AI 来电')).to_be_visible();assert page.evaluate('micRequests')==0
 page.get_by_role('button',name='拒绝',exact=True).click();done();assert page.evaluate('micRequests')==0
 send('请来电，测试冷却');done();expect(page.get_by_role('dialog',name='AI 来电')).to_have_count(0)
 state=page.evaluate(READ);assert state['settings']['incomingCallCooldownUntil']>0
 page.evaluate(RESET)
 # Accept -> finish model -> opening TTS -> mic. AI can end its bound call without aborting generation.
 send('请来电，测试接听');expect(page.get_by_role('dialog',name='AI 来电')).to_be_visible();assert page.evaluate('micRequests')==0
 page.screenshot(path=str(OUT/'incoming.png'));page.get_by_role('button',name='接听',exact=True).click();done();expect(page.locator('.call-bar')).to_contain_text('正在听',timeout=15000)
 assert page.evaluate('micRequests')==1;page.wait_for_timeout(500);page.locator('.call-bar').get_by_role('button',name='结束本句').click()
 expect(page.locator('.call-bar')).to_have_count(0,timeout=15000);done();assert page.evaluate('micStreams.every(s=>s.getTracks().every(t=>t.readyState==="ended"))')
 # Stop while ringing cancels; timeout doesn't open mic; reload doesn't redial.
 send('请来电，测试停止');expect(page.get_by_role('dialog',name='AI 来电')).to_be_visible();page.get_by_role('button',name='停止 ■',exact=True).click();done();expect(page.get_by_role('dialog',name='AI 来电')).to_have_count(0)
 send('请来电，测试超时');expect(page.get_by_role('dialog',name='AI 来电')).to_be_visible();done();expect(page.get_by_role('dialog',name='AI 来电')).to_have_count(0);assert page.evaluate('micRequests')==1
 page.reload();expect(page.get_by_role('dialog',name='AI 来电')).to_have_count(0);expect(page.locator('.call-bar')).to_have_count(0)
 # Human voice entry produces saved local audio; default model response remains text.
 page.get_by_role('button',name='录制语音条',exact=True).click();expect(page.locator('.recording-strip')).to_be_visible();page.wait_for_timeout(500);page.get_by_role('button',name='取消录音',exact=True).click();expect(page.locator('.recording-strip')).to_have_count(0)
 page.screenshot(path=str(OUT/'voice-history.png'));assert not errors,errors
 result={'passed':True,'requests':len(requests),'speech':speech,'page_errors':errors,'checks':['one-row 320/390/768/1280','collapse persisted','thought disabled hidden and unsent draft retained','AI voice generated saved playable after reload','reject no microphone','cooldown','accept opening then microphone','AI bound hangup','stop ringing','timeout','reload no redial','human recording entry and cancel']}
 (OUT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False));b.close()
