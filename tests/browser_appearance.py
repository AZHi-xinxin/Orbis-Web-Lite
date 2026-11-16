"""Subpath, theme, persistence and legacy compatibility; synthetic local data only."""
import json,os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
OUT=Path(os.environ.get('ORBIS_TEST_OUTPUT','/tmp/orbis-web-browser-tests'));OUT.mkdir(parents=True,exist_ok=True)
URL=os.environ.get('ORBIS_TEST_URL','http://127.0.0.1:18791/orbis-web/')
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/home/xinxin/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',headless=True,args=['--no-sandbox','--no-proxy-server'])
 ctx=b.new_context(viewport={'width':390,'height':844},color_scheme='light');page=ctx.new_page();errors=[];requests=[];bad=[]
 page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url));page.on('response',lambda r:bad.append((r.status,r.url)) if r.status>=400 else None)
 def ready():page.get_by_role('textbox',name='输入消息',exact=True).wait_for()
 def setting(label,value):
  page.get_by_role('button',name='设置',exact=True).click();page.get_by_label(label,exact=True).select_option(value);page.get_by_role('button',name='关闭面板').click()
 page.goto(URL);ready();expect(page.locator('html')).to_have_attribute('data-appearance','deepseek');expect(page.locator('h1')).to_have_text('欢迎回家')
 assert page.evaluate('getComputedStyle(document.body).backgroundColor')=='rgb(255, 255, 255)';page.screenshot(path=str(OUT/'deepseek-mobile-light.png'))
 page.emulate_media(color_scheme='dark');expect(page.locator('html')).to_have_attribute('data-orbis-theme','dark');assert page.evaluate('getComputedStyle(document.body).backgroundColor')=='rgb(26, 26, 26)';page.screenshot(path=str(OUT/'deepseek-mobile-dark.png'))
 setting('显示模式','light');page.reload();ready();expect(page.locator('html')).to_have_attribute('data-orbis-theme','light')
 setting('界面主题','orbis');page.reload();ready();expect(page.locator('html')).to_have_attribute('data-appearance','orbis');setting('界面主题','deepseek')
 page.get_by_role('button',name='新建对话',exact=True).click();expect(page.locator('.windows button')).to_have_count(2)
 page.get_by_role('button',name='打开窗口列表').click();page.get_by_role('textbox',name='搜索对话',exact=True).fill('不存在的标题');expect(page.locator('.windows button')).to_have_count(0);page.get_by_role('textbox',name='搜索对话',exact=True).fill('');expect(page.locator('.windows button')).to_have_count(2);page.screenshot(path=str(OUT/'deepseek-mobile-drawer.png'));page.get_by_role('button',name='收起窗口',exact=True).click()
 for width in [320,390,768,1280]:
  page.set_viewport_size({'width':width,'height':844});assert not page.evaluate('document.documentElement.scrollWidth>innerWidth'),width;assert page.locator('.composer').evaluate('(e)=>e.scrollWidth<=e.clientWidth'),width
 page.screenshot(path=str(OUT/'deepseek-desktop-light.png'))
 page.evaluate('''async()=>{const d=await new Promise(r=>{const q=indexedDB.open('orbis-web-lite-v1');q.onsuccess=()=>r(q.result)});const tx=d.transaction('state','readwrite'),store=tx.objectStore('state');const s=await new Promise(r=>{const q=store.get('main');q.onsuccess=()=>r(q.result)});delete s.settings.appearance;delete s.settings.colorMode;s.settings.dark=true;s.settings.name='旧窗口保留';s.revision++;store.put(s,'main');await new Promise(r=>tx.oncomplete=r)}''')
 page.reload();ready();expect(page.locator('html')).to_have_attribute('data-appearance','orbis');expect(page.locator('html')).to_have_attribute('data-orbis-theme','dark');expect(page.locator('.identity strong')).to_have_text('旧窗口保留');expect(page.locator('.windows button')).to_have_count(2)
 scope=page.evaluate('navigator.serviceWorker.ready.then(r=>r.scope)');assert scope.endswith('/orbis-web/'),scope
 ctx.set_offline(True);page.reload();ready();ctx.set_offline(False)
 assert not errors,errors;assert not bad,bad;assert all(x.startswith(URL.split('/orbis-web/')[0]+'/orbis-web/') for x in requests),requests
 result={'passed':True,'checks':['subpath assets only','fresh default deepseek','system dark live change','explicit mode persists','both appearances persist','window search','320/390/768/1280 no overflow','legacy settings and windows preserved','service worker scoped','offline shell reload'],'page_errors':errors,'failed_http':bad,'service_worker_scope':scope}
 (OUT/'appearance-browser-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(result);b.close()
