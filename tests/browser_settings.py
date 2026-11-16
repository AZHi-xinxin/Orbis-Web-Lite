"""UI-to-request roundtrip for settings, worldbook permission, and frozen tool continuations."""
import json,os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
OUT=Path(os.environ.get('ORBIS_TEST_OUTPUT','/tmp/orbis-web-browser-tests'));OUT.mkdir(parents=True,exist_ok=True)
requests=[]
def route(r):
 body=r.request.post_data_json;requests.append(body);content=body['messages'][-1]['content']
 tool=not any(x.get('type')=='tool_result' for x in content) and any('请修改世界书测试' in x.get('text','') for x in content)
 if tool:events=[{'type':'content_block_start','index':0,'content_block':{'type':'tool_use','id':'settings-test','name':'orbis_conversation_settings','input':{'action':'update','world_book_text':'新的世界书背景'}}}]
 else:events=[{'type':'content_block_delta','delta':{'text':'设置测试完成。'}}]
 events.append({'type':'message_stop'});r.fulfill(status=200,content_type='text/event-stream',body=''.join('data: '+json.dumps(x,ensure_ascii=False)+'\n\n' for x in events))
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/home/xinxin/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',headless=True,args=['--no-sandbox'])
 page=b.new_page(viewport={'width':390,'height':844});errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.route('https://api.deepseek.com/anthropic/v1/messages',route)
 page.goto(os.environ.get('ORBIS_TEST_URL','http://127.0.0.1:18791'));page.get_by_role('button',name='设置',exact=True).click()
 page.get_by_label('API Key',exact=True).fill('synthetic-not-a-key');page.get_by_label('本窗口补充提示词',exact=True).fill('当前窗口的人设补充');page.get_by_label('本窗口世界书',exact=True).fill('旧的世界书背景');page.get_by_label('允许 AI 修改本窗口提示词和世界书',exact=True).check()
 page.get_by_label('温度',exact=True).fill('0.7');page.get_by_label('Top-P',exact=True).fill('0.8');page.get_by_label('思考等级',exact=True).select_option('off');page.get_by_label('上下文最近轮数',exact=True).fill('1');page.get_by_role('button',name='关闭面板').click()
 def send(text):
  old=len(requests);page.get_by_role('textbox',name='输入消息',exact=True).fill(text);page.get_by_role('button',name='发送消息',exact=True).click();page.get_by_role('button',name='停止 ■').wait_for(state='hidden',timeout=15000);assert len(requests)>old
 send('请修改世界书测试');assert len(requests)==2
 for req in requests:
  assert '旧的世界书背景' in req['system'] and '新的世界书背景' not in req['system'];assert req['temperature']==.7 and 'top_p' not in req;assert req['thinking']=={'type':'disabled'}
 send('现在读取新背景');assert '新的世界书背景' in requests[-1]['system'];assert len(requests[-1]['messages'])==1
 page.get_by_role('button',name='设置',exact=True).click();expect(page.get_by_label('本窗口世界书',exact=True)).to_have_value('新的世界书背景');page.get_by_label('允许 AI 修改本窗口提示词和世界书',exact=True).uncheck();page.get_by_role('button',name='关闭面板').click();send('再确认工具权限');assert not any(t['name']=='orbis_conversation_settings' for t in requests[-1]['tools'])
 page.get_by_role('button',name='打开窗口列表').click();page.get_by_role('button',name='说明书与使用教程').click();expect(page.get_by_role('button',name='AI 工具速查',exact=True)).to_be_visible();page.get_by_role('button',name='AI 工具速查',exact=True).click();assert 'orbis_conversation_settings' in page.locator('.manual-body').inner_text();assert not page.evaluate('document.documentElement.scrollWidth>innerWidth');page.screenshot(path=str(OUT/'mobile-manual.png'));assert not errors,errors
 result={'passed':True,'requests':len(requests),'checks':['worldbook persisted from UI','same-name AI edit tool','next-turn configuration freeze','temperature and Top-P mapping','thinking toggle mapping','complete-turn context crop','permission off removes schema','in-app human and AI manual'],'page_errors':errors};(OUT/'settings-browser-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(result);b.close()
