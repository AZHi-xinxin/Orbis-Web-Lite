"""Human-owned name, visibility, persistence, actual request bytes; no paid API."""
import json,os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
OUT=Path(os.environ.get('ORBIS_TEST_OUTPUT','/tmp/orbis-web-browser-tests'));OUT.mkdir(parents=True,exist_ok=True)
URL=os.environ.get('ORBIS_TEST_URL','http://127.0.0.1:18791/orbis-web/')
requests=[]
def reply(r):
 requests.append(r.request.post_data_json)
 events=[{'type':'content_block_delta','delta':{'text':'收到测试消息。'}},{'type':'message_stop'}]
 r.fulfill(status=200,content_type='text/event-stream',body=''.join('data: '+json.dumps(e,ensure_ascii=False)+'\n\n' for e in events))
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/home/xinxin/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',headless=True,args=['--no-sandbox','--no-proxy-server'])
 page=b.new_page(viewport={'width':390,'height':844});errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.route('https://api.deepseek.com/anthropic/v1/messages',reply)
 page.goto(URL);expect(page.locator('h1')).to_have_text('欢迎回家')
 page.get_by_role('button',name='告诉 Orbis 怎么称呼你').click();expect(page.get_by_label('AI 可见',exact=True)).not_to_be_checked()
 page.get_by_label('你的称呼',exact=True).fill('小星');page.get_by_role('button',name='保存称呼',exact=True).click();expect(page.locator('h1')).to_have_text('小星，欢迎回家')
 page.reload();expect(page.locator('h1')).to_have_text('小星，欢迎回家');page.screenshot(path=str(OUT/'welcome-mobile-light.png'))
 page.get_by_role('button',name='设置',exact=True).click();page.get_by_label('API Key',exact=True).fill('synthetic-not-a-key');page.get_by_role('button',name='关闭面板').click()
 def send(text):
  old=len(requests);page.get_by_role('textbox',name='输入消息',exact=True).fill(text);page.get_by_role('button',name='发送消息',exact=True).click();page.get_by_role('button',name='停止 ■').wait_for(state='hidden',timeout=15000);assert len(requests)==old+1
 send('你好');assert '小星' not in json.dumps(requests[-1],ensure_ascii=False)
 page.get_by_role('button',name='打开窗口列表').click();page.get_by_role('button',name='修改我的称呼',exact=True).click();page.get_by_label('AI 可见',exact=True).check();page.screenshot(path=str(OUT/'profile-mobile-settings.png'));page.get_by_role('button',name='保存称呼',exact=True).click();page.get_by_role('button',name='收起窗口',exact=True).click()
 page.get_by_role('button',name='新建对话',exact=True).click();expect(page.locator('h1')).to_have_text('小星，欢迎回家');send('第一句话');assert '"preferred_name":"小星"' in requests[-1]['system'];assert len(requests[-1]['messages'])==1
 page.get_by_role('button',name='设置',exact=True).click();page.get_by_role('button',name='我的称呼：小星 · AI 可见 →',exact=True).click();page.get_by_label('AI 可见',exact=True).uncheck();page.get_by_role('button',name='保存称呼',exact=True).click();send('继续');assert '小星' not in json.dumps(requests[-1],ensure_ascii=False)
 page.get_by_role('button',name='新建对话',exact=True).click();page.emulate_media(color_scheme='dark');page.screenshot(path=str(OUT/'welcome-mobile-dark.png'))
 for width in [320,390,768,1280]:
  page.set_viewport_size({'width':width,'height':844});assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
 page.emulate_media(color_scheme='light');page.screenshot(path=str(OUT/'welcome-desktop-light.png'))
 page.get_by_role('button',name='修改我的称呼',exact=True).click();page.get_by_label('你的称呼',exact=True).fill('未保存称呼');page.get_by_role('button',name='关闭面板').click();expect(page.locator('h1')).to_have_text('小星，欢迎回家')
 page.get_by_role('button',name='设置',exact=True).click();page.get_by_label('界面主题',exact=True).select_option('orbis');page.get_by_role('button',name='关闭面板').click();expect(page.locator('h1')).to_have_text('小星，欢迎回家')
 assert not errors,errors
 result={'passed':True,'requests':len(requests),'checks':['display-only default','saved greeting persists','opt-in first new-window request includes name','opt-out excludes name on next request','cancel preserves original','both themes','four viewport widths','light and dark'],'page_errors':errors}
 (OUT/'profile-browser-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(result);b.close()
