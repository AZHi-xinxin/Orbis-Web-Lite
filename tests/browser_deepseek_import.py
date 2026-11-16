"""Local synthetic DS import; no credentials or private fixtures required.
Serve a build first. ORBIS_TEST_URL defaults to http://127.0.0.1:18801/orbis-web/.
"""
import json, os, subprocess, tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('ORBIS_TEST_OUTPUT', '/tmp/orbis-deepseek-browser'))
OUT.mkdir(parents=True, exist_ok=True)
URL = os.environ.get('ORBIS_TEST_URL', 'http://127.0.0.1:18801/orbis-web/')
with tempfile.TemporaryDirectory() as temp, sync_playwright() as p:
    subprocess.run(['node', 'tests/deepseek-fixtures.mjs', '--write', temp], cwd=ROOT, check=True)
    b = p.chromium.launch(executable_path=os.environ.get('ORBIS_CHROME'), headless=True)
    context = b.new_context(viewport={'width': 390, 'height': 844})
    q = context.new_page(); errors = []; remote = []
    q.on('pageerror', lambda e: errors.append(str(e)))
    def route(r):
        if r.request.url.startswith(URL): r.continue_()
        else: remote.append(r.request.url); r.abort()
    context.route('**/*', route)
    q.goto(URL)
    q.get_by_role('button', name='本地存储与清理提醒', exact=True).click()
    progress = q.get_by_test_id('deepseek-progress')
    q.get_by_label('导入 Lite 备份', exact=True).set_input_files(str(Path(temp) / 'branch.zip'))
    expect(progress).to_contain_text('已识别 1 个', timeout=30000)
    q.get_by_role('button', name='选择列表中的会话', exact=True).click()
    submit = q.get_by_role('button', name='导入所选 1 个 DeepSeek 会话', exact=True)
    # Simulated quota failure must leave the original window intact, without unhandled errors.
    q.evaluate('''() => {const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(v,...args){if(this.name==='state'&&v.windows?.some(w=>w.importKey?.startsWith('deepseek/'))){IDBObjectStore.prototype.put=put;throw new DOMException('合成空间不足','QuotaExceededError')}return put.call(this,v,...args)}}''')
    submit.click(); expect(progress).to_contain_text('未全部完成')
    assert q.locator('.windows button').count() == 1
    submit.click(); expect(progress).to_contain_text('已导入 1 个')
    submit.click(); expect(progress).to_contain_text('重复跳过 1 个')
    q.get_by_label('分支：合成 DS 分支', exact=True).select_option('3')
    submit.click(); expect(progress).to_contain_text('已导入 1 个')
    for width in [320, 390, 768, 1280]:
        q.set_viewport_size({'width': width, 'height': 844})
        assert not q.evaluate('document.documentElement.scrollWidth>innerWidth'), width
    q.set_viewport_size({'width': 390, 'height': 844}); q.screenshot(path=str(OUT / 'synthetic-import.png'))
    q.get_by_label('DeepSeek 官端导出 ZIP', exact=True).set_input_files(str(Path(temp) / 'long.zip'))
    expect(progress).to_contain_text('已识别 1 个')
    q.get_by_role('button', name='选择列表中的会话', exact=True).click()
    submit.click(); expect(progress).to_contain_text('已导入 1 个')
    q.get_by_role('button', name='关闭面板', exact=True).click()
    q.get_by_role('button', name='打开窗口列表', exact=True).click()
    q.locator('.windows button').filter(has_text='合成长聊天').click()
    expect(q.locator('.message')).to_have_count(80)
    expect(q.get_by_role('navigation', name='聊天历史分页')).to_contain_text('122–201')
    q.get_by_role('button', name='查看更早的 80 条', exact=True).click()
    expect(q.get_by_role('navigation', name='聊天历史分页')).to_contain_text('42–121')
    q.get_by_role('button', name='回到最新消息', exact=True).click()
    expect(q.get_by_role('navigation', name='聊天历史分页')).to_contain_text('122–201')
    q.reload(); expect(q.locator('.windows button')).to_have_count(4)
    q.get_by_role('button', name='本地存储与清理提醒', exact=True).click()
    with q.expect_download() as download:
        q.get_by_role('button', name='导出网页完整备份 ZIP', exact=True).click()
    full = str(Path(temp) / 'lite-roundtrip.zip'); download.value.save_as(full)
    other = b.new_context(viewport={'width': 390, 'height': 844})
    restored = other.new_page(); restored.on('pageerror', lambda e: errors.append(str(e)))
    restored.goto(URL); restored.get_by_role('button', name='本地存储与清理提醒', exact=True).click()
    restored.get_by_label('导入 Lite 备份', exact=True).set_input_files(full)
    restored.get_by_role('button', name='确认追加导入 Lite', exact=True).click()
    expect(restored.get_by_role('status')).to_contain_text('已追加 4 个窗口')
    restored.get_by_label('导入 Lite 备份', exact=True).set_input_files(full)
    restored.get_by_role('button', name='确认追加导入 Lite', exact=True).click()
    expect(restored.get_by_role('status')).to_contain_text('已追加 0 个窗口')
    restored.reload(); expect(restored.locator('.windows button')).to_have_count(5)
    assert not errors, errors
    assert not remote, remote
    result = {'passed': True, 'checks': ['DS routing from Lite input', 'quota failure atomicity', 'selected branches', 'dedup', 'pagination', 'reload', 'four widths', 'Lite ZIP roundtrip and dedup'], 'page_errors': errors, 'external_requests': len(remote)}
    (OUT / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps(result, ensure_ascii=False)); b.close()
