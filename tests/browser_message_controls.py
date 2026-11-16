"""Visible thought opt-out and per-request usage, including a low-hit tool first turn."""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
OUT=Path(os.environ.get('ORBIS_TEST_OUTPUT','/tmp/orbis-web-browser-tests'));OUT.mkdir(parents=True,exist_ok=True)
URL=os.environ.get('ORBIS_TEST_URL','http://127.0.0.1:18791/orbis-web/')
requests=[]
def reply(route):
 body=route.request.post_data_json;requests.append(body)
 last=body['messages'][-1]['content'];tool_result=any(p.get('type')=='tool_result' for p in last)
 text='\n'.join(p.get('text','') for p in last)
 tool='测试工具首轮' in text and not tool_result
 usage={'input_tokens':198080,'cache_read_input_tokens':1920,'cache_creation_input_tokens':0,'output_tokens':0} if tool else {'input_tokens':10000,'cache_read_input_tokens':200000,'cache_creation_input_tokens':0,'output_tokens':0}
 events=[{'type':'message_start','message':{'usage':usage}}]
 if tool:
  events += [{'type':'content_block_start','index':0,'content_block':{'type':'tool_use','id':'fixture-help','name':'orbis_help','input':{'topic':'chat'}}}]
 else:events += [{'type':'content_block_delta','delta':{'text':'这是第一段回复。\n\n这是第二段回复。'}}]
 events += [{'type':'message_delta','usage':{'output_tokens':23}},{'type':'message_stop'}]
 route.fulfill(status=200,content_type='text/event-stream',body=''.join('data: '+json.dumps(e,ensure_ascii=False)+'\n\n' for e in events))
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/home/xinxin/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',headless=True,args=['--no-sandbox','--no-proxy-server'])
 page=b.new_page(viewport={'width':390,'height':844});errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.route('https://api.deepseek.com/anthropic/v1/messages',reply)
 page.goto(URL);page.get_by_role('button',name='设置',exact=True).click();page.get_by_label('API Key',exact=True).fill('synthetic-not-a-key');page.get_by_role('button',name='关闭面板').click()
 def send(text):
  before=len(requests);page.get_by_role('textbox',name='输入消息',exact=True).fill(text);page.get_by_role('button',name='发送消息',exact=True).click();page.get_by_role('button',name='停止 ■').wait_for(state='hidden',timeout=15000);assert len(requests)>before
 toggle=page.get_by_role('button',name='人类思考链',exact=True)
 expect(toggle).to_have_attribute('aria-pressed','false');toggle.click();page.get_by_role('textbox',name='人类思考链',exact=True).fill('这个未发送的思考必须保留')
 page.get_by_role('button',name='关闭人类思考链',exact=True).click();expect(page.get_by_role('textbox',name='人类思考链',exact=True)).to_have_count(0)
 page.reload();expect(toggle).to_have_attribute('aria-pressed','false');send('思考关闭后的正文');assert '这个未发送的思考必须保留' not in json.dumps(requests[-1],ensure_ascii=False)
 toggle.click();page.get_by_role('textbox',name='人类思考链',exact=True).fill('公开的人类思考');send('这是带思考的正文');assert '公开的人类思考' in json.dumps(requests[-1]['messages'][-1],ensure_ascii=False)
 page.get_by_role('button',name='设置',exact=True).click();page.get_by_label('启用人类思考链（当前窗口）',exact=True).uncheck();page.get_by_role('button',name='关闭面板').click();expect(toggle).to_have_attribute('aria-pressed','false')
 send('测试工具首轮');assert len(requests)==4
 reports=page.locator('.usage-record');expect(reports).to_have_count(4)
 reports.nth(2).locator('summary').click();expect(reports.nth(2)).to_contain_text('1,920 token · 1.0%');expect(reports.nth(2)).to_contain_text('200,000 token')
 reports.nth(3).locator('summary').click();expect(reports.nth(3)).to_contain_text('200,000 token · 95.2%');expect(reports.nth(3)).to_contain_text('23 token')
 page.locator('.message.user').last.locator('.message-more summary').click();expect(page.locator('.message.user').last.get_by_role('button',name='撤回',exact=True)).to_be_visible();page.locator('.message.user').last.get_by_role('button',name='引用',exact=True).click();expect(page.locator('.composer .quote')).to_contain_text('测试工具首轮')
 page.screenshot(path=str(OUT/'message-controls-mobile.png'))
 for width in [320,390,768,1280]:
  page.set_viewport_size({'width':width,'height':844});assert not page.evaluate('document.documentElement.scrollWidth>innerWidth'),width
 page.set_viewport_size({'width':390,'height':844});page.emulate_media(color_scheme='dark');page.screenshot(path=str(OUT/'message-controls-dark.png'))
 page.reload();expect(page.locator('.usage-record')).to_have_count(4);page.locator('.usage-record').nth(2).locator('summary').click();expect(page.locator('.usage-record').nth(2)).to_contain_text('1,920 token')
 assert not errors,errors
 result={'passed':True,'requests':len(requests),'checks':['visible close button','settings opt-out','opt-out persists','no hidden thought sent','thought enabled request','toolbar quote and revoke menu','per-request first and continuation usage','usage reload persistence','four widths','light and dark'],'page_errors':errors}
 (OUT/'message-controls-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(result);b.close()
