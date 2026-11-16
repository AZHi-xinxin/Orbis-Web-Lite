"""8k messages, concurrent resumable summaries, one archive, N editable memories. Synthetic API only."""
import asyncio, json, os
from pathlib import Path
from playwright.async_api import async_playwright, expect
URL=os.environ.get('ORBIS_TEST_URL','http://127.0.0.1:18798/orbis-web/')
OUT=Path(os.environ.get('ORBIS_TEST_OUTPUT','/tmp/axu-long-compaction'));OUT.mkdir(parents=True,exist_ok=True)
READ="""async()=>{const d=await new Promise(r=>{const q=indexedDB.open('orbis-web-lite-v1');q.onsuccess=()=>r(q.result)});const s=await new Promise(r=>{const q=d.transaction('state').objectStore('state').get('main');q.onsuccess=()=>r(q.result)});d.close();return s}"""
DRAFT="""async()=>{const d=await new Promise(r=>{const q=indexedDB.open('orbis-web-lite-v1');q.onsuccess=()=>r(q.result)});const st=d.transaction('state').objectStore('state');const all=await new Promise(r=>{const q=st.getAll();q.onsuccess=()=>r(q.result)});d.close();return all.find(x=>x?.sourceHash)}"""
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,args=['--no-sandbox','--no-proxy-server'])
  page=await browser.new_page(viewport={'width':390,'height':844});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  calls=[];success=[];active=0;peak=0;failed=False
  async def model(route):
   nonlocal active,peak,failed
   body=route.request.post_data_json
   if '受人类委托整理历史聊天' in body.get('system',''):
    text=body['messages'][0]['content'][0]['text']
    # Host metadata may precede the actual text block; find the serialized history payload.
    for m in body['messages']:
     for c in m.get('content',[]):
      if isinstance(c,dict) and c.get('type')=='text' and 'next_history_fragment' in c.get('text',''):text=c['text']
    data=json.JSONDecoder().raw_decode(text[text.index('{"next_history_fragment":'):])[0];fragment=data['next_history_fragment'];calls.append(fragment)
    n=len(calls);active+=1;peak=max(peak,active)
    assert body['tools']==[] and '以阿止的第一人称' in body['system'] and 'previous_summary' not in data
    assert body['max_tokens'] in (8192,16384)
    await asyncio.sleep((n%3+1)*.025)
    truncate=n==5 and not failed
    if truncate:failed=True
    else:success.append(fragment)
    answer=('不完整' if truncate else '我是阿止，我记得这段的约定。'+'具体事件与尚未完成的安排。'*80)
    active-=1
   else:
    truncate=False;answer='压缩后的续聊正常。'
   events=[{'type':'content_block_start','index':0,'content_block':{'type':'text','text':answer}},{'type':'message_delta','delta':{'stop_reason':'max_tokens' if truncate else 'end_turn'}},{'type':'message_stop'}]
   await route.fulfill(status=200,content_type='text/event-stream',body=''.join('data: '+json.dumps(e,ensure_ascii=False)+'\n\n' for e in events))
  await page.route('https://api.deepseek.com/anthropic/v1/messages',model)
  await page.goto(URL)
  await page.get_by_role('button',name='设置',exact=True).click();await page.get_by_label('API Key',exact=True).fill('synthetic-key');await page.get_by_role('button',name='关闭面板').click()
  await page.evaluate('''async()=>{const db=await new Promise(r=>{const q=indexedDB.open('orbis-web-lite-v1');q.onsuccess=()=>r(q.result)});const t=db.transaction('state','readwrite'),st=t.objectStore('state'),q=st.get('main');q.onsuccess=()=>{const s=q.result;s.settings.semantic=false;s.settings.autoInject=false;s.settings.tutorialSeen=true;s.windows[0].messages=Array.from({length:8000},(_,i)=>({id:'old'+i,turn:'T'+Math.floor(i/2),role:i%2?'assistant':'user',text:'历史编号'+i+'约定'.repeat(110),at:100000+i,status:'done'}));st.put(s,'main')};await new Promise(r=>t.oncomplete=r);db.close();dispatchEvent(new Event('orbis-change'))}''')
  original=await page.evaluate(READ)
  await page.get_by_role('button',name='上下文与压缩').click()
  await page.get_by_label('压缩提示词（视角、风格与重点）').fill('以阿止的第一人称总结，保留约定。')
  await page.get_by_role('button',name='AI 分段生成摘要').click()
  await expect(page.locator('.context-actions [role="status"]')).to_contain_text('被截断',timeout=30000)
  checkpoint=await page.evaluate(DRAFT);total=len(checkpoint['completed']);done=sum(x is not None for x in checkpoint['completed'])
  assert total>70 and done>=4 and done<total and peak==3,(total,done,peak)
  check=await page.evaluate(READ)
  assert check['windows']==original['windows'], 'chat changed before application'
  assert check['notes']==original['notes'], 'memories changed before application'
  previous_success=list(success);prior_calls=len(calls)
  await page.reload();await page.get_by_role('button',name='上下文与压缩').click()
  await expect(page.locator('.context-actions [role="status"]')).to_contain_text('已恢复',timeout=10000)
  await page.get_by_label('单段输出上限').select_option('16384')
  await page.get_by_role('button',name='继续未完成的摘要').click()
  await expect(page.get_by_role('button',name='应用摘要并压缩')).to_be_enabled(timeout=60000)
  assert len(calls)-prior_calls==total-done
  assert all(x not in calls[prior_calls:] for x in previous_success)
  check=await page.evaluate(READ)
  assert check['windows']==original['windows'], 'chat changed before application'
  assert check['notes']==original['notes'], 'memories changed before application'
  draft=page.get_by_label('压缩摘要（可自行填写或修改）');value=await draft.input_value();assert len(value)>65536
  edited=value.replace('我是阿止','我是阿止，已由人类校对',1);await draft.fill(edited)
  await page.get_by_role('button',name='保存核对后的草稿').click()
  await expect(page.locator('.context-actions [role="status"]')).to_contain_text('核对后的草稿已保存')
  await page.reload();await page.get_by_role('button',name='上下文与压缩').click()
  await expect(page.get_by_label('压缩摘要（可自行填写或修改）')).to_have_value(edited)
  for width in [360,390,768,1440]:
   await page.set_viewport_size({'width':width,'height':900});assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
  await page.set_viewport_size({'width':390,'height':844});await page.screenshot(path=str(OUT/'review.png'))
  await page.get_by_role('button',name='应用摘要并压缩').click()
  await expect(page.locator('.context-actions [role="status"]')).to_contain_text('压缩已保存')
  state=await page.evaluate(READ);w=state['windows'][0];event=w['compressions'][0]
  assert len(state['windows'])==2 and len(state['notes'])==total and len(event['segments'])==total
  assert state['windows'][1]['messages']==original['windows'][0]['messages']
  assert '已由人类校对' in state['notes'][0]['body'] and len(w['messages'])==1
  await page.get_by_role('button',name='关闭面板').click()
  await page.get_by_role('textbox',name='输入消息',exact=True).fill('继续聊天');await page.get_by_role('button',name='发送消息',exact=True).click()
  await expect(page.locator('main')).to_contain_text('压缩后的续聊正常。')
  assert not errors,errors
  result={'original_messages':8000,'segments':total,'peak_concurrency':peak,'failed_segment':5,'saved_on_failure':done,'resume_requests':len(calls)-prior_calls,'repeated_successful_segments':0,'review_persisted':True,'edited_notes':True,'original_backup_windows':1,'memories':len(state['notes']),'chat_continues':True,'page_errors':errors}
  (OUT/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result));await browser.close()
asyncio.run(main())
