"""Synthetic provider tests: no real model credentials or private conversations."""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
OUT=Path(os.environ.get('ORBIS_TEST_OUTPUT','/tmp/orbis-web-browser-tests'));OUT.mkdir(parents=True,exist_ok=True)
requests=[]
def stream(text='',name=None,args=None):
 events=[{'type':'message_start','message':{'id':'fixture','role':'assistant','content':[]}}]
 if name:
  events += [{'type':'content_block_start','index':0,'content_block':{'type':'tool_use','id':'call-'+str(len(requests)),'name':name,'input':{}}},{'type':'content_block_delta','index':0,'delta':{'type':'input_json_delta','partial_json':json.dumps(args,ensure_ascii=False)}},{'type':'content_block_stop','index':0}]
 else:events += [{'type':'content_block_start','index':0,'content_block':{'type':'text','text':''}},{'type':'content_block_delta','index':0,'delta':{'type':'text_delta','text':text}},{'type':'content_block_stop','index':0}]
 events += [{'type':'message_delta','delta':{'stop_reason':'tool_use' if name else 'end_turn'}},{'type':'message_stop'}]
 return ''.join('event: '+e['type']+'\ndata: '+json.dumps(e,ensure_ascii=False)+'\n\n' for e in events)
def route(r):
 body=r.request.post_data_json;requests.append(body);last=body['messages'][-1]['content']
 if any(x.get('type')=='tool_result' for x in last):payload=stream('工具结果已收到，继续聊。')
 else:
  text='\n'.join(x.get('text','') for x in last)
  if '请记住测试偏好' in text:payload=stream(name='orbis_memory',args={'body':'我喜欢海边的星空','summary':'喜欢海边星空','keywords':['海边','星空'],'state':'conditional'})
  elif '请进行压缩测试' in text:payload=stream(name='compact',args={'summary':'我们讨论了海边与星空，这是测试摘要。','keep_recent':2})
  else:payload=stream('这是模拟接口的回复。\n\n跨窗流程已经经过测试。')
 r.fulfill(status=200,content_type='text/event-stream',body=payload)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('ORBIS_CHROME','/home/xinxin/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome'),headless=True,args=['--no-sandbox'])
 ctx=b.new_context(viewport={'width':390,'height':844});page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.route('https://api.deepseek.com/anthropic/v1/messages',route)
 page.goto(os.environ.get('ORBIS_TEST_URL','http://127.0.0.1:18791'));page.get_by_role('button',name='设置',exact=True).click();page.get_by_label('API Key',exact=True).fill('synthetic-not-a-key');page.get_by_role('button',name='关闭面板').click()
 def send(text):
  before=len(requests);page.get_by_role('textbox',name='输入消息',exact=True).fill(text);page.get_by_role('button',name='发送消息',exact=True).click();page.get_by_role('button',name='停止 ■').wait_for(state='hidden',timeout=15000);assert len(requests)>before
 send('请记住测试偏好')
 assert len(requests)==2 and requests[1]['messages'][-1]['content'][0]['type']=='tool_result'
 page.get_by_role('button',name='打开窗口列表').click();page.get_by_role('button',name='开一个新窗口').click()
 send('海边星空还记得吗')
 assert '我喜欢海边的星空' in json.dumps(requests[-1],ensure_ascii=False)
 page.get_by_label('记忆档位').select_option('light');send('海边星空还记得吗')
 # The last request contains previous visible conversations, but no automatic memory envelope.
 assert '[Orbis 历史资料' not in json.dumps(requests[-1],ensure_ascii=False)
 page.get_by_role('button',name='打开窗口列表').click();page.get_by_role('button',name='记忆库').click();assert '这里还没有匹配的记忆' in page.locator('body').inner_text();page.get_by_role('button',name='关闭面板').click();page.get_by_role('button',name='收起窗口').click()
 page.get_by_label('记忆档位').select_option('standard')
 page.get_by_role('button',name='人类思考链',exact=True).click();page.get_by_role('textbox',name='人类思考链',exact=True).fill('我自己写的思考')
 send('这是带思考的正文');assert '【人类思考链】' in json.dumps(requests[-1],ensure_ascii=False)
 page.locator('.message.user').last.locator('.message-more summary').click();page.locator('.message.user').last.get_by_role('button',name='引用',exact=True).click();send('这是引用回复');assert '[引用历史消息' in json.dumps(requests[-1],ensure_ascii=False)
 page.locator('.message.user').filter(has_text='这是带思考的正文').first.locator('.message-more summary').click();page.locator('.message.user').filter(has_text='这是带思考的正文').first.get_by_role('button',name='撤回',exact=True).click();expect(page.locator('.retracted')).to_have_count(1)
 send('撤回之后继续');assert '我自己写的思考' not in json.dumps(requests[-1],ensure_ascii=False)
 send('请进行压缩测试');page.get_by_role('button',name='上下文与压缩',exact=True).click();page.get_by_role('button',name='打开压缩前原文').wait_for();page.get_by_role('button',name='撤销最近一次压缩').click();expect(page.get_by_role('button',name='撤销最近一次压缩')).to_be_disabled();page.get_by_role('button',name='关闭面板').click()
 assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
 page.screenshot(path=str(OUT/'mobile-chat-flow.png'))
 page.reload();page.get_by_role('textbox',name='输入消息',exact=True).wait_for();assert page.locator('.windows button').count()==3
 page.get_by_role('button',name='打开窗口列表').click();page.get_by_role('button',name='导入与导出').click()
 with page.expect_download() as event:page.get_by_role('button',name='导出可供 Android Orbis 导入的聊天 JSON',exact=True).click()
 dest=OUT/'universal-chat.json';event.value.save_as(dest);archive=json.loads(dest.read_text());assert archive['format']=='orbis_chat' and len(archive['conversations'])==3
 assert not errors,errors
 (OUT/'browser-result.json').write_text(json.dumps({'passed':True,'requests':len(requests),'checks':['tool call loop','cross-window memory','light isolation','human thought','quote','retract','compaction branch','rollback','reload persistence','universal export','390px no overflow'],'page_errors':errors},ensure_ascii=False,indent=2))
 print((OUT/'browser-result.json').read_text());b.close()
