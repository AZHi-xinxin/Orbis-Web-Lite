import { useEffect, useState } from 'react'
import type { State } from './core.js'
import { download, fullBackup, restoreBackup, universalChat } from './backup.js'
import { speechSettings } from './speech.js'
import { encryptedBackup, openBackup } from './portableBackup.js'
import { DeepSeekImportPanel } from './DeepSeekImportPanel.js'
import { LocalZip } from './localZip.js'
import {
  remembersSecrets,
  rememberSecrets,
  saveSecret,
  secretSnapshot,
  transact,
} from './storage.js'
const size = (n?: number) => (n === undefined ? '浏览器未提供' : (n / 1048576).toFixed(1) + ' MiB')
export function KeyStorageChoice({ fail }: { fail: (e: unknown) => void }) {
  const [remember, setRemember] = useState(remembersSecrets)
  return (
    <div className="key-storage-choice">
      <label className="toggle">
        <input
          type="checkbox"
          aria-label="在此设备保存密钥"
          checked={remember}
          onChange={(e) => {
            try {
              rememberSecrets(e.target.checked)
              setRemember(e.target.checked)
            } catch (error) {
              fail(error)
            }
          }}
        />
        在此设备保存密钥
      </label>
      <p className="subtle">
        {remember
          ? '关闭页面后仍可使用。密钥保存在当前浏览器，不上传本站；清除网站数据会删除。'
          : '当前只在本标签页会话保存；结束会话后可能需要重填。'}{' '}
        普通 ZIP 不包含密钥。
      </p>
    </div>
  )
}
export function StoragePanel({
  state,
  onState,
  notify,
  fail,
  busy,
}: {
  state: State
  onState: (s: State) => void
  notify: (s: string) => void
  fail: (e: unknown) => void
  busy: boolean
}) {
  const [storage, setStorage] = useState<{
    persisted?: boolean
    usage?: number
    quota?: number
    error?: string
  }>({})
  const [password, setPassword] = useState(''),
    [includeKeys, setIncludeKeys] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null),
    [importPassword, setImportPassword] = useState('')
  const [deepSeekFile, setDeepSeekFile] = useState<File | null>(null)
  const [restoreSettings, setRestoreSettings] = useState(true),
    [restoreKeys, setRestoreKeys] = useState(false),
    [working, setWorking] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<any>(null)
  const inspect = async () => {
    try {
      const estimate = await navigator.storage?.estimate?.()
      setStorage({ ...estimate, persisted: await navigator.storage?.persisted?.() })
    } catch {
      setStorage({ error: '浏览器未提供存储状态，聊天仍以保存结果为准' })
    }
  }
  useEffect(() => {
    void inspect()
    const handle = (e: Event) => {
      e.preventDefault()
      setInstallPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handle)
    return () => window.removeEventListener('beforeinstallprompt', handle)
  }, [])
  const exportEncrypted = async () => {
    setWorking(true)
    try {
      const bytes = await encryptedBackup(state, password, includeKeys ? secretSnapshot() : {})
      download(
        'Orbis-Lite-' + new Date().toISOString().slice(0, 10) + '.orbis',
        bytes as BlobPart,
        'application/octet-stream'
      )
      setPassword('')
      notify('加密备份已交给浏览器下载，请到“文件/下载”中确认保存')
    } catch (e) {
      fail(e)
    } finally {
      setWorking(false)
    }
  }
  const importBackup = async () => {
    if (!importFile || busy || working) return
    setWorking(true)
    try {
      if (importFile.size > 128 * 1024 * 1024 * 1.4) {
        throw Error('此入口仅用于 Lite 完整备份；DeepSeek 官端 ZIP 请用上方导入入口（支持按会话读取大型包）')
      }
      const opened = await openBackup(
        new Uint8Array(await importFile.arrayBuffer()),
        importPassword
      )
      if (restoreKeys && !restoreSettings)
        throw Error('恢复密钥时请同时恢复对应连接设置，避免密钥与地址错配')
      const result = await transact((s) =>
        restoreBackup(s, opened.zip, { settings: restoreSettings, tasks: true })
      )
      let savedKeys = 0,
        keyError = ''
      if (restoreSettings) {
        const before = speechSettings(state.settings),
          after = speechSettings(result.state.settings)
        for (const [key, oldURL, newURL] of [
          ['api', state.settings.endpoint, result.state.settings.endpoint],
          ['asr', before.asrEndpoint, after.asrEndpoint],
          ['tts', before.ttsEndpoint, after.ttsEndpoint],
        ]) {
          if (oldURL.replace(/\/$/, '') !== newURL.replace(/\/$/, '')) saveSecret(key, '')
        }
      }
      if (restoreKeys)
        try {
          for (const [k, v] of Object.entries(opened.secrets)) {
            const target = result.result.secretKeyMap[k]
            if (target) {
              saveSecret(target, v)
              savedKeys++
            }
          }
        } catch {
          keyError = '；部分密钥未能保存，请在连接设置重新填写'
        }
      onState(result.state)
      setImportFile(null)
      setImportPassword('')
      await inspect()
      notify(
        `已追加 ${result.result.windows} 个窗口、${result.result.notes} 条记忆${restoreSettings ? '，设置已恢复' : ''}${savedKeys ? `，恢复 ${savedKeys} 项密钥` : ''}。导入哨兵保持暂停，新增 MCP 工具保持关闭${keyError}`
      )
    } catch (e) {
      fail(e)
    } finally {
      setWorking(false)
    }
  }
  return (
    <div className="local-storage-panel">
      <div className="storage-status">
        <strong>资料保存在这台设备的当前浏览器</strong>
        <p>
          {state.windows.length} 个窗口 · {state.notes.filter((n) => !n.deleted).length} 条记忆 ·
          网站占用约 {size(storage.usage)}
        </p>
        <small>
          {storage.error ||
            (storage.persisted === true
              ? '已获持久存储许可，降低系统自动回收风险'
              : storage.persisted === false
                ? '尚未获得持久存储许可'
                : '此浏览器不支持查询持久存储许可')}
        </small>
      </div>
      <p>
        没有云端账号。Chrome、微信内置网页、Safari
        和主屏幕图标可能各有独立资料；不同手机不会自动同步。建议固定一种打开方式，换入口前先导出，再在新入口导入。
      </p>
      <KeyStorageChoice fail={fail} />
      <button
        disabled={working}
        onClick={() =>
          void (async () => {
            try {
              if (!navigator.storage?.persist)
                throw Error('此浏览器不支持申请持久存储，请定期导出备份')
              const ok = await navigator.storage.persist()
              await inspect()
              notify(
                ok
                  ? '已获持久存储许可；清除网站数据仍会删除本地资料'
                  : '浏览器未授予持久存储许可，请保留导出备份'
              )
            } catch (e) {
              fail(e)
            }
          })()
        }
      >
        申请持久保存
      </button>
      <h3>清理前先看这里</h3>
      <div className="storage-table-wrap">
        <table className="storage-table">
          <thead>
            <tr>
              <th>你清理的项目</th>
              <th>可能影响</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>缓存图片与文件、临时文件</td>
              <td>通常只清掉页面、图标和离线资源；聊天与设置通常仍在。下次需联网重新加载。</td>
            </tr>
            <tr>
              <td>Cookie 与网站数据、网站存储、所有网站数据</td>
              <td>
                <strong>会删除聊天、记忆、附件、设置及已保存密钥。</strong>
                页面仍能重新打开，但可能变成空白初始状态。
              </td>
            </tr>
            <tr>
              <td>浏览器应用的“清除数据 / 清除存储”，卸载浏览器</td>
              <td>
                <strong>可能连同全部本地聊天和配置一起删除。</strong>重新安装不会从本站自动找回。
              </td>
            </tr>
            <tr>
              <td>删除主屏幕快捷方式 / 卸载 Web App</td>
              <td>
                入口图标会消失；不同系统对数据处理不同，卸载 Web App
                可能同时删除其独立数据。操作前先导出。
              </td>
            </tr>
            <tr>
              <td>关闭页面、无痕模式</td>
              <td>
                普通模式下聊天通常保留；未勾选保存的密钥会随会话结束消失。无痕窗口关闭后资料通常会被删除。
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="info">
        “清除历史记录与网站数据”“一键清理”等按钮可能同时清掉多项，请以勾选项目为准。手机存储不足或浏览器回收也可能影响数据；持久保存许可不能代替备份。
      </p>
      <details>
        <summary>添加到主屏幕与固定入口</summary>
        <p>
          iPhone：在 Safari 打开本站，点“分享 → 添加到主屏幕”。Android：在 Chrome
          菜单选择“添加到主屏幕 / 安装应用”。微信中可先选择“在浏览器打开”。
        </p>
        <p>
          iPhone 主屏幕应用可能有独立存储，原 Safari
          里的聊天不会自动搬进去；先在原入口导出，再在新入口导入一次。以后固定从同一图标打开。
        </p>
        {installPrompt && (
          <button
            onClick={() =>
              void installPrompt
                .prompt()
                .then(() => setInstallPrompt(null))
                .catch(fail)
            }
          >
            安装到主屏幕
          </button>
        )}
      </details>
      <h3>Lite 完整备份 · 可原路导回</h3>
      <button
        className="primary"
        disabled={working}
        onClick={() => {
          try {
            download(
              'Orbis-Lite-' + new Date().toISOString().slice(0, 10) + '.zip',
              fullBackup(state) as BlobPart,
              'application/zip'
            )
          } catch (e) {
            fail(e)
          }
        }}
      >
        导出网页完整备份 ZIP
      </button>
      <p className="subtle">
        包括聊天、记忆、附件、注入记录、压缩原文与回退点、设置和哨兵规则；不含密钥。可在 Lite
        追加导入，重复导入会去重。哨兵导入后暂停，MCP 新导入工具默认关闭。
      </p>
      <details>
        <summary>加密备份（可带连接密钥）</summary>
        <label>
          备份密码
          <input
            type="password"
            autoComplete="new-password"
            aria-label="备份密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="至少 8 个字符"
          />
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={includeKeys}
            onChange={(e) => setIncludeKeys(e.target.checked)}
          />
          包含当前 API / 语音 / MCP 密钥
        </label>
        <p className="subtle">在设备上加密后下载，不上传本站。请另存密码，丢失后无法找回。</p>
        <button disabled={working || password.length < 8} onClick={() => void exportEncrypted()}>
          {working ? '正在处理…' : '导出加密 Lite 备份'}
        </button>
      </details>
      <DeepSeekImportPanel file={deepSeekFile} busy={busy} onWorking={setWorking} onState={onState} notify={notify} />
      <label className="import-file">
        导回 Lite：选择完整 ZIP 或加密 .orbis 文件
        <input
          aria-label="导入 Lite 备份"
          type="file"
          accept=".zip,.orbis"
          disabled={busy || working}
          onChange={async (e) => {
            const file = e.target.files?.[0] ?? null
            e.target.value = ''
            if (!file) { return }
            setImportFile(null)
            if (file.name.toLowerCase().endsWith('.zip')) {
              try {
                const zip = await LocalZip.open(file)
                if ([...zip.entries.keys()].some(n => /(^|\/)(chat_session_index|conversations)\.json$/.test(n))) {
                  setDeepSeekFile(file)
                  return
                }
              } catch { /* The Lite parser provides its format-specific error below. */ }
            }
            setImportFile(file)
          }}
        />
      </label>
      {importFile && (
        <div className="info">
          <strong>{importFile.name}</strong>
          {!importFile.name.toLowerCase().endsWith('.zip') && (
            <label>
              解密密码
              <input
                aria-label="解密密码"
                type="password"
                value={importPassword}
                onChange={(e) => setImportPassword(e.target.value)}
              />
            </label>
          )}
          <label className="toggle">
            <input
              type="checkbox"
              checked={restoreSettings}
              onChange={(e) => setRestoreSettings(e.target.checked)}
            />
            恢复连接、外观等设置（替换当前设置）
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={restoreKeys}
              onChange={(e) => setRestoreKeys(e.target.checked)}
            />
            恢复加密包内的密钥（替换对应密钥）
          </label>
          <p>
            已有聊天不会被覆盖；有差异的同名窗口另存。更换服务地址会清除旧地址对应密钥，避免发错服务。密码错误或校验失败不会改动现有数据。
          </p>
          <button disabled={busy || working} onClick={() => void importBackup()}>
            确认追加导入 Lite
          </button>
        </div>
      )}
      <h3>给 Android Orbis</h3>
      <button
        onClick={() =>
          download(
            'Orbis-通用聊天.json',
            JSON.stringify(universalChat(state), null, 2),
            'application/json'
          )
        }
      >
        导出可供 Android Orbis 导入的聊天 JSON
      </button>
      <p className="subtle">
        这个兼容入口只带文字、思考和时间。完整 ZIP / 加密包用于 Lite 恢复，不是现有 Android
        的全量备份格式。
      </p>
    </div>
  )
}
