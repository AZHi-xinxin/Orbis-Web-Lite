import json,os,threading,time
from pathlib import Path
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from playwright.sync_api import sync_playwright,expect
OUT=Path(os.environ.get('ORBIS_TEST_OUTPUT','/tmp/orbis-web-browser-tests'));OUT.mkdir(parents=True,exist_ok=True)
calls=[]
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*a):pass
 def cors_headers(self):
  self.send_header('Access-Control-Allow-Origin','*');self.send_header('Access-Control-Allow-Headers','Authorization, Content-Type');self.send_header('Access-Control-Allow-Methods','POST, OPTIONS')
 def do_OPTIONS(self):self.send_response(204);self.cors_headers();self.end_headers()
 def do_POST(self):
  calls.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))));self.send_response(200);self.cors_headers();self.send_header('Content-Type','text/event-stream');self.end_headers()
  try:
   self.wfile.write(('data: '+json.dumps({'choices':[{'delta':{'content':'这是一段尚未完成的回复'}}]},ensure_ascii=False)+'\n\n').encode());self.wfile.flush();time.sleep(8);self.wfile.write(b'data: [DONE]\n\n');self.wfile.flush()
  except (BrokenPipeError,ConnectionResetError):pass
server=ThreadingHTTPServer(('127.0.0.1',18792),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/home/xinxin/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',headless=True,args=['--no-sandbox']);page=b.new_page();page.goto('http://127.0.0.1:18791');page.get_by_role('button',name='设置',exact=True).click();page.get_by_label('API Key',exact=True).fill('synthetic-not-a-key');page.get_by_label('接口基础地址',exact=True).fill('http://127.0.0.1:18792');page.get_by_role('combobox',name='接口协议',exact=True).select_option('openai');page.get_by_role('button',name='关闭面板').click();page.get_by_role('textbox',name='输入消息',exact=True).fill('开始测试停止');page.get_by_role('button',name='发送消息',exact=True).click();expect(page.locator('.bubble').filter(has_text='这是一段尚未完成的回复')).to_be_visible();page.get_by_role('button',name='停止 ■').click();page.get_by_role('button',name='停止 ■').wait_for(state='hidden');page.reload();expect(page.locator('.bubble').filter(has_text='这是一段尚未完成的回复')).to_be_visible();page.wait_for_timeout(1500);assert len(calls)==1
 result={'passed':True,'requests':len(calls),'partial_persisted':True,'no_auto_restart_after_stop_and_reload':True};(OUT/'stop-browser-result.json').write_text(json.dumps(result,indent=2));print(result);b.close()
server.shutdown()
