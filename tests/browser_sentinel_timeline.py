"""A wakeup is a collapsed timeline event; opening it never edits conversation data."""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

URL = os.environ.get('ORBIS_TEST_URL', 'http://127.0.0.1:18795/orbis-web/')
OUT = Path(os.environ.get('ORBIS_TEST_OUTPUT', '/tmp/axu-lite-alpha10-timeline'))
OUT.mkdir(parents=True, exist_ok=True)
READ = """async()=>{const db=await new Promise(r=>{const q=indexedDB.open('orbis-web-lite-v1');q.onsuccess=()=>r(q.result)});return await new Promise(r=>{const q=db.transaction('state').objectStore('state').get('main');q.onsuccess=()=>{r(q.result);db.close()}})}"""
WRITE = """async s=>{const db=await new Promise(r=>{const q=indexedDB.open('orbis-web-lite-v1');q.onsuccess=()=>r(q.result)});await new Promise((r,j)=>{const t=db.transaction('state','readwrite');t.objectStore('state').put(s,'main');t.oncomplete=r;t.onerror=j});db.close()}"""

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/home/xinxin/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', headless=True, args=['--no-sandbox', '--no-proxy-server'])
    page = browser.new_page(viewport={'width':390, 'height':844}, timezone_id='America/Los_Angeles')
    errors, api_calls = [], []
    page.on('pageerror', lambda e: errors.append(str(e)))
    def no_model(route):
        api_calls.append(route.request.url)
        route.abort()
    page.route('https://api.deepseek.com/**', no_model)
    page.goto(URL)
    # Cause a normal settings write to initialize the isolated browser's database.
    page.get_by_role('button', name='设置', exact=True).click()
    page.get_by_label('API Key', exact=True).fill('synthetic-never-sent')
    page.get_by_role('button', name='关闭面板', exact=True).click()
    page.wait_for_timeout(600)
    state = page.evaluate(READ)
    assert state
    messages = [
        {'id':'human-fixture', 'role':'user', 'text':'定时唤醒这几个字只是我写的普通消息。', 'at':1794829200000, 'timeZone':'Asia/Shanghai'},
        {'id':'event-fixture', 'role':'user', 'event':True, 'text':'[定时唤醒；非人类新发言]\n这是合成的哨兵触发详情。\n到了约定时间，由 AI 自行开启对话。', 'at':1794829381944, 'timeZone':'Asia/Shanghai'},
        {'id':'assistant-fixture', 'role':'assistant', 'text':'到了约定的时间，我来看看你。', 'at':1794829382944, 'timeZone':'Asia/Shanghai'},
    ]
    for i, message in enumerate(messages):
        message['turn'] = 'fixture-turn-' + str(i)
    state['windows'][0]['messages'] = messages
    state['sentinels'] = []
    state['revision'] += 1
    page.evaluate(WRITE, state)
    page.reload()
    page.wait_for_timeout(300)
    assert not errors, errors
    assert page.evaluate(READ)['windows'][0]['messages'] == messages
    event = page.locator('#msg-event-fixture')
    details = event.locator('details.sentinel-timeline')
    summary = details.locator('summary').first
    expect(summary).to_contain_text('19:43')
    assert 'user' not in event.get_attribute('class').split()
    assert event.locator('.bubble,.speaker').count() == 0
    expect(details).not_to_have_attribute('open', '')
    expect(event.locator('.sentinel-event-content')).not_to_be_visible()
    expect(page.locator('#msg-human-fixture')).to_have_class('message user')
    before = page.evaluate(READ)['windows'][0]['messages']
    page.screenshot(path=str(OUT/'collapsed-mobile.png'))
    summary.click()
    expect(event.locator('.sentinel-event-content')).to_be_visible()
    expect(event).to_contain_text('本地自主哨兵')
    expect(event).to_contain_text('2026-11-16 19:43:01+08:00')
    expect(event).to_contain_text(messages[1]['text'])
    expect(event.get_by_role('button', name='复制', exact=True)).to_be_visible()
    page.screenshot(path=str(OUT/'expanded-mobile.png'))
    for width in [320,390,768,1280]:
        page.set_viewport_size({'width':width, 'height':844})
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth'), width
    page.set_viewport_size({'width':390, 'height':844})
    page.emulate_media(color_scheme='dark')
    page.screenshot(path=str(OUT/'expanded-dark.png'))
    summary.focus()
    page.keyboard.press('Enter')
    expect(event.locator('.sentinel-event-content')).not_to_be_visible()
    page.keyboard.press('Space')
    expect(event.locator('.sentinel-event-content')).to_be_visible()
    assert page.evaluate(READ)['windows'][0]['messages'] == before
    page.reload()
    expect(page.locator('.sentinel-event-content')).not_to_be_visible()
    assert page.evaluate(READ)['windows'][0]['messages'] == before
    assert not errors, errors
    assert not api_calls, api_calls
    result = {'passed':True, 'default_collapsed':True, 'human_bubble_removed':True,
              'ordinary_human_text_unchanged':True, 'stored_time_zone_preserved':True,
              'keyboard_accessible':True, 'messages_byte_equivalent':True,
              'model_requests':0, 'widths':[320,390,768,1280], 'page_errors':errors}
    (OUT/'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps(result, ensure_ascii=False))
    browser.close()
