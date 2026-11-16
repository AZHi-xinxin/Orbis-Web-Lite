"""Human grants only; synthetic AI reads live time then creates its own rule."""
import json,os,time
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
URL=os.environ.get('ORBIS_TEST_URL','http://127.0.0.1:18795/orbis-web/')
OUT=Path(os.environ.get('ORBIS_TEST_OUTPUT','/tmp/axu-lite-alpha9-time-sentinel'));OUT.mkdir(parents=True,exist_ok=True)
READ="""async()=>{const db=await new Promise(r=>{const q=indexedDB.open('orbis-web-lite-v1');q.onsuccess=()=>r(q.result)});return await new Promise(r=>{const q=db.transaction('state').objectStore('state').get('main');q.onsuccess=()=>{r(q.result);db.close()}})}"""
requests=[];time_readings=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/home/xinxin/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',headless=True,args=['--no-sandbox','--no-proxy-server'])
 page=b.new_page(viewport={'width':390,'height':844},timezone_id='Asia/Shanghai');errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 def model(route):
  body=route.request.post_data_json;requests.append(body)
  assert 'Asia/Shanghai' in json.dumps(body,ensure_ascii=False)
  names=[t['name'] for t in body['tools']];assert 'orbis_time' in names
  results=[x for m in body['messages'] for x in m['content'] if x['type']=='tool_result']
  if 'orbis_sentinel' not in names:block={'type':'text','text':'哨兵未获授权，我不会创建规则。'}
  elif not results:block={'type':'tool_use','name':'orbis_time','id':'now-clock','input':{}}
  elif len(results)==1:
   value=json.loads(results[-1]['content']);time_readings.append(value);assert value['time_zone']=='Asia/Shanghai';assert abs(value['unix_ms']-time.time()*1000)<10000
   block={'type':'tool_use','name':'orbis_sentinel','id':'own-rule','input':{'action':'create','type':'once','name':'AI 自主合成规则','prompt':'到了合成时间，我自行决定如何开启这次对话。','due_at_ms':value['unix_ms']+3600000,'timezone':value['time_zone']}}
  else:
   assert json.loads(results[-1]['content'])['saved'] is True
   block={'type':'text','text':'我已自行安排好一条规则。'}
  events=[{'type':'content_block_start','index':0,'content_block':block},{'type':'message_stop'}]
  route.fulfill(status=200,content_type='text/event-stream',body=''.join('data: '+json.dumps(e,ensure_ascii=False)+'\n\n' for e in events))
 page.route('https://api.deepseek.com/anthropic/v1/messages',model);page.goto(URL)
 page.get_by_role('button',name='设置',exact=True).click();page.get_by_label('API Key',exact=True).fill('synthetic-key');page.get_by_role('button',name='关闭面板').click()
 def panel():
  page.get_by_role('button',name='打开窗口列表',exact=True).click();page.get_by_role('button',name='◷ 哨兵与主动消息',exact=True).click()
 def close():
  page.get_by_role('button',name='关闭面板',exact=True).click();page.get_by_role('button',name='收起窗口',exact=True).click()
 def send(text):
  page.get_by_role('textbox',name='输入消息',exact=True).fill(text);page.get_by_role('button',name='发送消息',exact=True).click();page.get_by_role('button',name='停止 ■',exact=True).wait_for(state='hidden',timeout=20000)
 panel();box=page.get_by_role('dialog',name='sentinel',exact=True);expect(page.get_by_label('允许基础哨兵与 AI 主动消息',exact=True)).not_to_be_checked()
 assert box.locator('textarea,select,input:not([type=checkbox])').count()==0
 assert not page.evaluate(READ)['sentinels']
 page.get_by_label('允许基础哨兵与 AI 主动消息',exact=True).check();expect(box).to_contain_text('已授权。');assert not page.evaluate(READ)['sentinels'];assert not requests
 page.screenshot(path=str(OUT/'master-only.png'));close();send('你可以按自己的想法安排一条规则。')
 expect(page.locator('main')).to_contain_text('我已自行安排好一条规则。',timeout=20000)
 state=page.evaluate(READ);assert len(state['sentinels'])==1 and len(requests)==3;assert state['sentinels'][0]['timezone']=='Asia/Shanghai'
 assert state['windows'][0]['messages'][0]['timeZone']=='Asia/Shanghai'
 panel();expect(box).to_contain_text('AI 自主合成规则');assert box.locator('textarea,select,input:not([type=checkbox])').count()==0
 assert box.get_by_role('button',name='删除',exact=True).count()==0
 assert box.get_by_role('button',name='暂停',exact=True).count()==0
 page.screenshot(path=str(OUT/'ai-rule-readonly.png'));page.get_by_label('允许基础哨兵与 AI 主动消息',exact=True).uncheck();expect(box).to_contain_text('授权关闭，暂不触发')
 close();send('授权关闭后，再确认一次。');assert len(page.evaluate(READ)['sentinels'])==1
 assert len(requests)==4 and all(t['name']!='orbis_sentinel' for t in requests[-1]['tools'])
 page.reload();assert len(page.evaluate(READ)['sentinels'])==1 and len(requests)==4
 assert not errors,errors
 (OUT/'result.json').write_text(json.dumps({'passed':True,'requests':4,'human_form_removed':True,'toggle_creates_no_rules_or_requests':True,'ai_created_rule_after_clock_query':True,'human_master_off_preserves_rule_and_hides_tool':True,'timezone':'Asia/Shanghai','reload_no_replay':True,'page_errors':errors},ensure_ascii=False,indent=2));b.close()
