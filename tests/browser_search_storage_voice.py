"""Mock provider integration, local persistence and real browser mic lifecycle. No user data."""
import base64, io, json, os, wave
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
OUT=Path(os.environ.get('ORBIS_TEST_OUTPUT','/tmp/orbis-alpha5-browser'));OUT.mkdir(parents=True,exist_ok=True)
URL=os.environ.get('ORBIS_TEST_URL','http://127.0.0.1:18791/orbis-web/')
requests=[];voice=[]
def model(route):
 body=route.request.post_data_json;requests.append(body)
 if any(t.get('type')=='deepseek_web_search' for t in body['tools']):
  blocks=[{'type':'server_tool_use','name':'deepseek_web_search','id':'web-'+str(len(requests)),'input':{'queries':['合成资料查询']}},{'type':'web_search_tool_result','tool_use_id':'web-'+str(len(requests)),'content':[{'type':'web_search_result','url':'https://example.org/fixture','title':'合成来源','snippet':'用于验证来源卡片的合成摘录'}]},{'type':'text','text':'这是有来源的合成回答。'}]
 else:blocks=[{'type':'text','text':'这是语音测试回复。'}]
 events=[{'type':'content_block_start','index':i,'content_block':x} for i,x in enumerate(blocks)]+[{'type':'message_stop'}]
 route.fulfill(status=200,content_type='text/event-stream',body=''.join('data: '+json.dumps(e,ensure_ascii=False)+'\n\n' for e in events))
def asr(route):
 voice.append('asr');assert route.request.headers['authorization']=='Bearer synthetic-key'
 assert b'RIFF' in route.request.post_data_buffer
 route.fulfill(status=200,json={'text':'合成语音消息','duration_ms':1000})
def tts(route):
 voice.append('tts');payload=route.request.post_data_json;assert payload['voice_id']=='tide';assert payload['format']=='wav'
 f=io.BytesIO()
 with wave.open(f,'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(24000);w.writeframes(b'\0\0'*(240000 if voice.count('tts')>1 else 2400))
 route.fulfill(status=200,content_type='audio/wav',body=f.getvalue())
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/home/xinxin/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',headless=True,args=['--no-sandbox','--no-proxy-server','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required'])
 ctx=b.new_context(viewport={'width':390,'height':844},permissions=['microphone']);ctx.route('https://api.deepseek.com/anthropic/v1/messages',model);ctx.route('https://api.deepseek.com/v1/tools/asr',asr);ctx.route('https://api.deepseek.com/v1/tools/tts',tts)
 page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto(URL)
 page.get_by_role('button',name='设置',exact=True).click();page.get_by_label('API Key',exact=True).fill('synthetic-key');page.get_by_label('在此设备保存密钥',exact=True).check();page.get_by_label('回复朗读服务',exact=True).select_option('deepseek');page.get_by_label('DeepSeek TTS 音色',exact=True).select_option('tide');page.get_by_role('button',name='关闭面板').click()
 page.get_by_role('button',name='智能搜索',exact=True).click();page.get_by_role('textbox',name='输入消息',exact=True).fill('测试搜索');page.get_by_role('button',name='发送消息',exact=True).click();page.get_by_role('button',name='停止 ■').wait_for(state='hidden');expect(page.locator('.web-results')).to_have_count(1);page.locator('.web-results summary').click();expect(page.locator('.web-source[href="https://example.org/fixture"]')).to_be_visible()
 page.screenshot(path=str(OUT/'search-mobile.png'));page.get_by_role('button',name='添加附件',exact=True).click();expect(page.get_by_label('选择附件类型')).to_be_visible();assert not page.evaluate('document.documentElement.scrollWidth>innerWidth');page.screenshot(path=str(OUT/'attachments-mobile.png'))
 page.get_by_label('选择附件类型').locator('input').nth(2).set_input_files({'name':'note.txt','mimeType':'text/plain','buffer':'这是附件文字'.encode()});page.get_by_role('button',name='发送消息',exact=True).click();page.get_by_role('button',name='停止 ■').wait_for(state='hidden');assert '这是附件文字' in json.dumps(requests[-1],ensure_ascii=False)
 page.get_by_role('button',name='本地存储与清理提醒',exact=True).click();expect(page.get_by_role('heading',name='本地存储与备份',exact=True)).to_be_visible()
 with page.expect_download() as d:page.get_by_role('button',name='导出网页完整备份 ZIP',exact=True).click()
 archive=OUT/'roundtrip.zip';d.value.save_as(archive)
 page.get_by_text('加密备份（可带连接密钥）',exact=True).click();page.get_by_label('备份密码',exact=True).fill('synthetic-password');page.get_by_label('包含当前 API / 语音 / MCP 密钥',exact=True).check()
 with page.expect_download() as d:page.get_by_role('button',name='导出加密 Lite 备份',exact=True).click()
 encrypted=OUT/'roundtrip.orbis';d.value.save_as(encrypted);assert b'synthetic-key' not in encrypted.read_bytes()
 # new tab: same local database and opted-in key, without copying sessionStorage
 page.close();page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(URL);expect(page.locator('.web-results')).to_have_count(2);page.get_by_role('button',name='设置',exact=True).click();expect(page.get_by_label('API Key',exact=True)).to_have_value('synthetic-key');page.get_by_role('button',name='关闭面板').click()
 page.get_by_role('button',name='智能搜索',exact=True).click()
 # real browser mic nodes receive fake audio; mock ASR/TTS intercept all outbound speech
 page.get_by_role('button',name='开始语音通话',exact=True).click();expect(page.locator('.call-bar')).to_contain_text('正在听');page.wait_for_timeout(500);page.locator('.call-bar').get_by_role('button',name='结束本句').click();expect(page.locator('.call-bar')).to_contain_text('正在听',timeout=15000);assert voice==['asr','tts'],voice;page.wait_for_timeout(500);page.locator('.call-bar').get_by_role('button',name='结束本句').click();expect(page.locator('.call-bar')).to_contain_text('正在说',timeout=15000);page.get_by_role('button',name='打断朗读',exact=True).click();expect(page.locator('.call-bar')).to_contain_text('正在听');page.locator('.call-bar').get_by_role('button',name='挂断').click();expect(page.locator('.call-bar')).to_have_count(0)
 # importing in a separate browser storage area, with wrong-password no mutation first
 other=b.new_context(viewport={'width':390,'height':844});q=other.new_page();q.on('pageerror',lambda e:errors.append(str(e)));q.goto(URL);q.get_by_role('button',name='本地存储与清理提醒',exact=True).click();q.get_by_label('导入 Lite 备份',exact=True).set_input_files(encrypted);q.get_by_label('解密密码',exact=True).fill('wrong-password');q.get_by_role('button',name='确认追加导入 Lite',exact=True).click();expect(q.get_by_role('status')).to_contain_text('密码不正确');assert q.locator('.windows button').count()==1
 q.get_by_label('解密密码',exact=True).fill('synthetic-password');q.get_by_label('恢复加密包内的密钥（替换对应密钥）',exact=True).check();q.get_by_role('button',name='确认追加导入 Lite',exact=True).click();expect(q.get_by_role('status')).to_contain_text('已追加 1 个窗口');q.get_by_label('导入 Lite 备份',exact=True).set_input_files(archive);q.get_by_role('button',name='确认追加导入 Lite',exact=True).click();expect(q.get_by_role('status')).to_contain_text('已追加 0 个窗口、0 条记忆');q.get_by_role('button',name='关闭面板').click();q.get_by_role('button',name='设置',exact=True).click();expect(q.get_by_label('API Key',exact=True)).to_have_value('synthetic-key');q.get_by_role('button',name='关闭面板').click()
 for width in [320,390,768,1280]:
  q.set_viewport_size({'width':width,'height':844});assert not q.evaluate('document.documentElement.scrollWidth>innerWidth'),width
 q.set_viewport_size({'width':390,'height':844});q.emulate_media(color_scheme='dark');q.get_by_role('button',name='本地存储与清理提醒',exact=True).click();q.screenshot(path=str(OUT/'storage-dark.png'));assert not errors,errors
 result={'passed':True,'model_requests':len(requests),'voice_requests':voice,'checks':['server-side search and source cards','text attachment','local key survives new tab','ZIP export and dedup restore','encrypted export with keys','wrong password no mutation','voice ASR/model/TTS/listen/interrupt/hangup','320/390/768/1280 layouts','dark storage reminder'],'page_errors':errors};(OUT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False));b.close()
