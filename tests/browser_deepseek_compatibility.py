"""Synthetic missing-field import, read-only history and document roundtrip in the actual UI."""
import json, os, tempfile, zipfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
URL=os.environ.get('ORBIS_TEST_URL','http://127.0.0.1:18813/orbis-web/')
OUT=Path(os.environ['ORBIS_TEST_OUTPUT']);OUT.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory() as temp, sync_playwright() as p:
    raw={'id':'compatibility','title':'合成缺失字段','pinned':True,'current_message_id':2,'messages':[
        {'id':1,'parent_id':None,'role':'USER','fragments':[{'type':'REQUEST','content':'问题原文'}, {'type':'FILE','files':[{'file_name':'report.pdf','export_path':'chat_sessions/compatibility_files/report.pdf'}]}]},
        {'id':2,'parent_id':1,'role':'ASSISTANT','inserted_at':'invalid','fragments':[{'type':'THINK','content':'思考原文','elapsed_secs':2.5},{'type':'TOOL_SEARCH','status':'FINISHED','results':[{'url':'https://example.invalid/no-fetch','title':'合成来源'}]},{'type':'RESPONSE','content':'回答原文'}]}]}
    source=Path(temp)/'missing.zip'
    with zipfile.ZipFile(source,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('导出/manifest.json',json.dumps({'export_format_version':3}))
        z.writestr('导出/chat_sessions/compatibility.json',json.dumps(raw,ensure_ascii=False))
        z.writestr('导出/chat_sessions/compatibility_files/report.pdf','%PDF-synthetic')
    b=p.chromium.launch(headless=True)
    context=b.new_context(viewport={'width':390,'height':844});q=context.new_page();errors=[];remote=[]
    q.on('pageerror',lambda e:errors.append(str(e)))
    def route(r):
        if r.request.url.startswith(URL):r.continue_()
        else:remote.append(r.request.url);r.abort()
    context.route('**/*',route)
    q.goto(URL);q.get_by_role('button',name='本地存储与清理提醒',exact=True).click()
    q.get_by_label('DeepSeek 官端导出 ZIP',exact=True).set_input_files(source)
    expect(q.get_by_test_id('deepseek-progress')).to_contain_text('已识别 1 个')
    expect(q.get_by_text('原包缺少索引',exact=False)).to_be_visible()
    q.get_by_role('button',name='选择列表中的会话',exact=True).click()
    q.get_by_label('同时恢复包内图片、音频与文档',exact=True).check()
    q.get_by_role('button',name='导入所选 1 个 DeepSeek 会话',exact=True).click()
    expect(q.get_by_test_id('deepseek-progress')).to_contain_text('恢复 1 个附件')
    q.screenshot(path=str(OUT/'preview.png'))
    q.get_by_role('button',name='关闭面板',exact=True).click()
    q.get_by_role('button',name='打开窗口列表',exact=True).click()
    expect(q.locator('.windows button').first).to_contain_text('合成缺失字段')
    q.locator('.windows button').filter(has_text='合成缺失字段').click()
    expect(q.locator('.speaker time')).to_have_text(['原时间未知','原时间未知'])
    expect(q.get_by_text('思考过程 · 2.5 秒',exact=True)).to_be_visible()
    history=q.locator('details.tool').filter(has_text='历史检索')
    assert history.get_attribute('open') is None
    history.locator('summary').click();expect(history.get_by_role('link',name='合成来源')).to_be_visible()
    with q.expect_download() as d:q.get_by_role('link',name='下载附件：report.pdf',exact=True).click()
    doc=Path(temp)/'report.pdf';d.value.save_as(doc);assert doc.read_bytes()==b'%PDF-synthetic'
    for width in [320,390,768,1280]:
        q.set_viewport_size({'width':width,'height':844})
        assert not q.evaluate('document.documentElement.scrollWidth>innerWidth'),width
    q.set_viewport_size({'width':390,'height':844});q.screenshot(path=str(OUT/'history.png'))
    q.reload();q.get_by_role('button',name='打开窗口列表',exact=True).click()
    q.locator('.windows button').filter(has_text='合成缺失字段').click()
    expect(q.locator('.speaker time')).to_have_text(['原时间未知','原时间未知'])
    q.get_by_role('button',name='本地存储与清理提醒',exact=True).click()
    with q.expect_download() as d:q.get_by_role('button',name='导出网页完整备份 ZIP',exact=True).click()
    backup=Path(temp)/'backup.zip';d.value.save_as(backup)
    with zipfile.ZipFile(backup) as z: state=json.loads(z.read('state.json'))
    w=next(w for w in state['windows'] if w['title']=='合成缺失字段')
    assert w['pinned'] and w['messages'][1]['reasoningMs']==2500
    assert w['messages'][0]['files'][0]['mime']=='application/pdf'
    assert not any(m.get('calls') or m.get('providerContent') for m in w['messages'])
    other=b.new_context();restored=other.new_page();restored.goto(URL)
    restored.get_by_role('button',name='本地存储与清理提醒',exact=True).click()
    restored.get_by_label('导入 Lite 备份',exact=True).set_input_files(backup)
    restored.get_by_role('button',name='确认追加导入 Lite',exact=True).click()
    expect(restored.locator('.windows button').filter(has_text='合成缺失字段')).to_have_count(1)
    assert not errors,errors
    assert not remote,remote
    (OUT/'result.json').write_text(json.dumps({'passed':True,'unknownTimes':True,'pinned':True,'historyCollapsedAndInert':True,'documentDownloaded':True,'fullBackupRestored':True,'reload':True,'responsive':True,'remoteRequests':remote,'pageErrors':errors},indent=2))
    b.close()
