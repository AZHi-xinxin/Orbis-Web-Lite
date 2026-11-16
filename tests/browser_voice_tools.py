"""All model/ASR/TTS traffic is synthetic; real browser audio lifecycle and IDB."""
import io,json,os,wave
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
OUT=Path(os.environ.get('ORBIS_TEST_OUTPUT','/tmp/orbis-alpha6-browser'));OUT.mkdir(parents=True,exist_ok=True)
URL=os.environ.get('ORBIS_TEST_URL','http://127.0.0.1:18791/orbis-web/')
requests=[];speech=[];summaries=[]
LONG_CAPTION='字幕开头。\n\n'+('这是完整的通话字幕，长段落应该能上下滚动阅读。\n\n'*12)+'https://example.test/'+('longword'*35)+'\n字幕结尾。'
def model(route):
 body=route.request.post_data_json;requests.append(body)
 last=body['messages'][-1]['content']
 if '你正在整理刚结束的语音通话' in json.dumps(body.get('system'),ensure_ascii=False):
  assert not body.get('tools');summaries.append(body)
  route.fulfill(status=200,content_type='text/event-stream',body='data: '+json.dumps({'type':'content_block_start','index':0,'content_block':{'type':'text','text':'本次聊了合成通话，已确认结束；没有新增待办。'}},ensure_ascii=False)+'\n\ndata: {"type":"message_stop"}\n\n');return
 if last and last[-1].get('type')=='tool_result':
  blocks=[{'type':'text','text':LONG_CAPTION}]
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
 page.evaluate("""()=>{window.blockedPlays=0;window.playElements=[];const original=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){if(this.src.startsWith('blob:')){playElements.push(this);if(blockedPlays++===0)return Promise.reject(new DOMException('synthetic browser policy','NotAllowedError'))}return original.call(this)}}""")
 page.screenshot(path=str(OUT/'incoming.png'));page.get_by_role('button',name='接听',exact=True).click();done()
 expect(page.get_by_role('button',name='开启声音并播放',exact=True)).to_be_visible(timeout=15000)
 assert page.evaluate('micRequests')==0
 synthesized=len(speech);page.screenshot(path=str(OUT/'playback-recovery.png'))
 page.get_by_role('button',name='开启声音并播放',exact=True).click()
 expect(page.locator('.voice-call-screen')).to_contain_text('正在听',timeout=15000)
 assert len(speech)==synthesized
 assert page.evaluate('playElements.length===2 && playElements[0]===playElements[1]')
 # Long subtitles keep their entire text, first/last lines and an explicit full view.
 for width,height in [(320,568),(390,700),(390,844),(768,844)]:
  page.set_viewport_size({'width':width,'height':height})
  caption=page.get_by_label('当前通话字幕',exact=True)
  assert caption.locator('p').inner_text()==LONG_CAPTION
  assert caption.evaluate('(e)=>e.scrollHeight>e.clientHeight && e.scrollWidth<=e.clientWidth')
  caption.evaluate('(e)=>e.scrollTop=0')
  assert caption.evaluate('(e)=>e.firstElementChild.getBoundingClientRect().top>=e.getBoundingClientRect().top')
  caption.evaluate('(e)=>e.scrollTop=e.scrollHeight')
  assert caption.evaluate("""e=>{const t=e.firstElementChild.firstChild,r=document.createRange();r.setStart(t,t.length-5);r.setEnd(t,t.length);const last=[...r.getClientRects()].at(-1),box=e.getBoundingClientRect();return last.top>=box.top && last.bottom<=box.bottom}""")
  page.get_by_role('button',name='查看完整字幕',exact=False).click()
  full=page.get_by_role('dialog',name='完整通话字幕',exact=True)
  assert full.locator('.call-caption-full').inner_text()==LONG_CAPTION
  assert full.evaluate('(e)=>e.scrollWidth<=innerWidth')
  full.get_by_role('button',name='关闭完整字幕',exact=True).click()
 page.set_viewport_size({'width':390,'height':844});page.locator('.voice-call-screen').evaluate('(e)=>e.scrollTop=0')
 page.get_by_label('当前通话字幕',exact=True).evaluate('(e)=>e.scrollTop=0')
 page.screenshot(path=str(OUT/'long-caption.png'))
 assert page.evaluate('micRequests')==1;page.wait_for_timeout(500);page.locator('.voice-call-screen').get_by_role('button',name='说完了，发送本句').click()
 expect(page.locator('.voice-call-screen')).to_have_count(0,timeout=15000);done();assert page.evaluate('micStreams.every(s=>s.getTracks().every(t=>t.readyState==="ended"))')
 expect(page.locator('.voice-call-card')).to_have_count(1)
 expect(page.locator('.voice-call-card')).to_contain_text('已归档')
 assert len(summaries)==1
 state=page.evaluate(READ);call=state['windows'][0]['voiceSessions'][0]
 assert call['status']=='ended' and call['summaryStatus']=='done'
 assert any(m.get('files') for m in call['raw'])
 assert any(m.get('voiceSessionId')==call['id'] for m in state['windows'][0]['messages'])
 page.locator('.voice-call-card').get_by_role('button',name='查看完整记录').click()
 expect(page.get_by_role('dialog',name='完整通话记录')).to_contain_text('合成挂断')
 expect(page.get_by_role('dialog',name='完整通话记录').locator('audio')).to_have_count(1)
 page.screenshot(path=str(OUT/'call-records.png'));page.get_by_role('button',name='关闭通话记录').click()
 page.reload();expect(page.locator('.voice-call-card')).to_contain_text('已归档');assert len(summaries)==1
 # Stop while ringing cancels; timeout doesn't open mic; reload doesn't redial.
 send('请来电，测试停止');expect(page.get_by_role('dialog',name='AI 来电')).to_be_visible();page.get_by_role('button',name='停止 ■',exact=True).click();done();expect(page.get_by_role('dialog',name='AI 来电')).to_have_count(0)
 send('请来电，测试超时');expect(page.get_by_role('dialog',name='AI 来电')).to_be_visible();done();expect(page.get_by_role('dialog',name='AI 来电')).to_have_count(0);assert page.evaluate('micRequests')==0
 page.reload();expect(page.get_by_role('dialog',name='AI 来电')).to_have_count(0);expect(page.locator('.voice-call-screen')).to_have_count(0)
 # Human initiated call: independent UI, minimize/restore and mute controls, empty hangup.
 page.get_by_role('button',name='开始语音通话',exact=True).click()
 expect(page.get_by_role('dialog',name='语音通话',exact=True)).to_be_visible()
 page.get_by_role('dialog',name='语音通话',exact=True).get_by_role('button',name='关闭麦克风',exact=True).click()
 expect(page.get_by_role('button',name='打开麦克风',exact=True)).to_be_visible()
 assert page.evaluate('micStreams.every(s=>s.getTracks().every(t=>t.readyState==="ended"))')
 page.get_by_role('button',name='关闭声音',exact=True).click()
 expect(page.get_by_role('button',name='打开声音',exact=True)).to_be_visible()
 page.screenshot(path=str(OUT/'call-fullscreen.png'))
 page.get_by_role('dialog',name='语音通话',exact=True).get_by_role('button',name='收起',exact=True).click()
 expect(page.locator('.call-mini')).to_be_visible()
 page.get_by_role('button',name='返回通话界面',exact=True).click()
 expect(page.get_by_role('dialog',name='语音通话',exact=True)).to_be_visible()
 for width in [320,390,768,1280]:
  page.set_viewport_size({'width':width,'height':844})
  assert not page.evaluate('document.documentElement.scrollWidth>innerWidth'),width
  expect(page.get_by_role('button',name='挂断通话',exact=True)).to_be_in_viewport()
 page.set_viewport_size({'width':390,'height':844})
 page.get_by_role('button',name='挂断通话',exact=True).click();done()
 expect(page.locator('.voice-call-card')).to_have_count(2)
 assert len(summaries)==1 # An empty call must not request a model summary.
 page.screenshot(path=str(OUT/'call-ended.png'))
 # Human voice entry produces saved local audio; default model response remains text.
 page.get_by_role('button',name='录制语音条',exact=True).click();expect(page.locator('.recording-strip')).to_be_visible();page.wait_for_timeout(500);page.get_by_role('button',name='取消录音',exact=True).click();expect(page.locator('.recording-strip')).to_have_count(0)
 page.screenshot(path=str(OUT/'voice-history.png'));assert not errors,errors
 result={'passed':True,'requests':len(requests),'speech':speech,'page_errors':errors,'checks':['one-row 320/390/768/1280','collapse persisted','thought disabled hidden and unsent draft retained','AI voice generated saved playable after reload','reject no microphone','cooldown','accept opening then microphone','blocked playback resumes the same element with no extra TTS','AI bound hangup','one isolated summary','raw audio retained','manual call','minimize restores','mic and speaker controls','empty call no model request','4 viewport call controls','long caption all text, first/last lines, unbroken URL and full reader at 320/390/768 widths','refresh no summary replay','stop ringing','timeout','reload no redial','human recording entry and cancel']}
 (OUT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False));b.close()
