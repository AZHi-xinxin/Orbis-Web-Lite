import { useEffect, useRef, useState } from 'react'
import type { State, Window } from './core.js'
import { appendDeepSeek, type DeepSeekPreview } from './deepSeekImport.js'
import { acquire, transact } from './storage.js'

export function DeepSeekImportPanel({
  file,
  busy,
  onWorking,
  onState,
  notify,
}: {
  file: File | null
  busy: boolean
  onWorking: (working: boolean) => void
  onState: (s: State) => void
  notify: (text: string) => void
}) {
  const worker = useRef<Worker | null>(null),
    epoch = useRef(0)
  const pending = useRef(
    new Map<string, { resolve: (value: unknown) => void; reject: (e: Error) => void }>()
  )
  const [previews, setPreviews] = useState<DeepSeekPreview[]>([]),
    [selected, setSelected] = useState<Record<string, string>>({})
  const [working, setWorking] = useState(false),
    [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(''),
    [name, setName] = useState(''),
    [media, setMedia] = useState(false),
    [filter, setFilter] = useState('')
  const stop = () => {
    epoch.current++
    worker.current?.terminate()
    worker.current = null
    for (const p of pending.current.values()) {
      p.reject(Error('已停止；完成的会话保留，可重新选择原包继续'))
    }
    pending.current.clear()
  }
  const request = <T,>(message: Record<string, unknown>) =>
    new Promise<T>((resolve, reject) => {
      const target = worker.current
      if (!target) {
        reject(Error('请重新选择 DeepSeek 导出包'))
        return
      }
      const id = crypto.randomUUID()
      pending.current.set(id, { resolve: (v) => resolve(v as T), reject })
      target.postMessage({ ...message, id })
    })
  const choose = async (input: File | null) => {
    if (!input || busy || importing) {
      return
    }
    stop()
    setPreviews([])
    setSelected({})
    setName(input.name)
    setFilter('')
    const run = epoch.current
    const target = new Worker(new URL('./deepSeekImport.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.current = target
    target.onmessage = (event) => {
      const data = event.data
      if (data.progress) {
        setProgress(`正在检查会话 ${data.progress.done} / ${data.progress.total}…`)
        return
      }
      const p = pending.current.get(data.id)
      pending.current.delete(data.id)
      if (data.error) {
        p?.reject(Error(data.error))
      } else {
        p?.resolve(data.result)
      }
    }
    target.onerror = () => {
      stop()
      setProgress('读取进程中断，请重新选择文件；原文件未改动')
      setWorking(false)
      onWorking(false)
    }
    setWorking(true)
    onWorking(true)
    setProgress('正在读取文件目录，附件不会整包解压…')
    try {
      const result = await request<DeepSeekPreview[]>({ action: 'inspect', file: input })
      if (run !== epoch.current) {
        return
      }
      setPreviews(result)
      setProgress(`已识别 ${result.length} 个会话，请选择要导入的会话和分支`)
    } catch (e) {
      if (run === epoch.current) {
        setProgress(e instanceof Error ? e.message : '读取失败')
      }
    } finally {
      if (run === epoch.current) {
        setWorking(false)
        onWorking(false)
      }
    }
  }
  const chooseRef = useRef(choose)
  chooseRef.current = choose
  useEffect(() => {
    if (file) {
      void chooseRef.current(file)
    }
  }, [file])
  useEffect(
    () => () => {
      stop()
      onWorking(false)
    },
    [onWorking]
  )
  const importSelected = async () => {
    if (working || busy) {
      return
    }
    const choices = Object.entries(selected)
    if (!choices.length) {
      return
    }
    const run = epoch.current
    let release: (() => Promise<void>) | undefined,
      imported = 0,
      skipped = 0,
      restored = 0,
      references = 0,
      error = ''
    setWorking(true)
    setImporting(true)
    onWorking(true)
    try {
      release = await acquire('deepseek-import')
      for (let i = 0; i < choices.length; i++) {
        if (run !== epoch.current) {
          throw Error('已停止')
        }
        const [conversation, leaf] = choices[i]
        setProgress(
          `正在导入 ${i + 1} / ${choices.length}，已完成 ${imported} 个，重复跳过 ${skipped} 个…`
        )
        const prepared = await request<{ window: Window; attachments: number; restored: number }>({
          action: 'prepare',
          conversation,
          leaf,
          media,
        })
        if (run !== epoch.current) {
          throw Error('已停止')
        }
        const result = await transact((s) => appendDeepSeek(s, prepared.window))
        if (result.result) {
          imported++
          restored += prepared.restored
          references += prepared.attachments - prepared.restored
        } else {
          skipped++
        }
        onState(result.state)
      }
    } catch (e) {
      error = e instanceof Error ? e.message : '导入中断'
    } finally {
      await release?.()
      const text = `DeepSeek 已导入 ${imported} 个会话，重复跳过 ${skipped} 个；恢复 ${restored} 个附件，${references} 个附件保留引用。${error ? '未全部完成：' + error : '已完成。'}`
      setProgress(text)
      notify(text)
      setWorking(false)
      setImporting(false)
      onWorking(false)
    }
  }
  const visible = previews.filter((p) =>
    p.title.toLocaleLowerCase().includes(filter.toLocaleLowerCase())
  )
  return (
    <section className="deepseek-import">
      <h3>导入 DeepSeek 官端聊天</h3>
      <p>
        支持新版分会话 ZIP 与旧版 conversations.json
        ZIP。保留所选分支的文字、思考和时间，追加导入、重复去重；其他分支仍在原包。只在本机读取，不上传本站，不恢复账号或修改连接设置。
      </p>
      <label>
        选择 DeepSeek 官端导出 ZIP
        <input
          aria-label="DeepSeek 官端导出 ZIP"
          type="file"
          accept=".zip"
          disabled={busy || working}
          onChange={(e) => {
            void choose(e.target.files?.[0] ?? null)
            e.target.value = ''
          }}
        />
      </label>
      {name && <p className="subtle">{name}</p>}
      <p aria-live="polite" data-testid="deepseek-progress">
        {progress}
      </p>
      {previews.length > 0 && (
        <>
          <label>
            查找会话
            <input
              aria-label="查找 DeepSeek 会话"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
          <div className="button-row">
            <button
              disabled={working || busy}
              onClick={() =>
                setSelected(Object.fromEntries(visible.map((p) => [p.id, p.selected])))
              }
            >
              选择列表中的会话
            </button>
            <button disabled={working || busy} onClick={() => setSelected({})}>
              取消全部选择
            </button>
          </div>
          <div className="deepseek-import-list">
            {visible.map((p) => (
              <div key={p.id} className="deepseek-import-item">
                <label className="toggle">
                  <input
                    type="checkbox"
                    aria-label={'导入会话：' + p.title}
                    disabled={working || busy}
                    checked={p.id in selected}
                    onChange={(e) =>
                      setSelected((old) => {
                        const next = { ...old }
                        if (e.target.checked) {
                          next[p.id] = p.selected
                        } else {
                          return Object.fromEntries(Object.entries(next).filter(([key]) => key !== p.id))
                        }
                        return next
                      })
                    }
                  />
                  {p.title}
                </label>
                {p.warnings?.map((warning, i) => <p className="subtle" key={i}>{warning}</p>)}
                <label>
                  分支（共 {p.messages} 条消息）
                  <select
                    aria-label={'分支：' + p.title}
                    disabled={working || busy || !(p.id in selected)}
                    value={selected[p.id] ?? p.selected}
                    onChange={(e) => setSelected((old) => ({ ...old, [p.id]: e.target.value }))}
                  >
                    {p.branches.map((b, i) => (
                      <option key={b.id} value={b.id}>
                        {b.id === p.selected ? '原包当前分支 · ' : `分支 ${i + 1} · `}
                        {b.count} 条 · {b.timeUnknown ? '原时间未知' : new Date(b.at).toLocaleString()}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ))}
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={media}
              disabled={working || busy}
              onChange={(e) => setMedia(e.target.checked)}
            />
            同时恢复包内图片、音频与文档
          </label>
          <p className="subtle">
            默认导入文字，附件保留引用。恢复附件时单文件最多 16 MiB、每会话合计 64 MiB；PDF、TXT、Markdown、CSV、DOCX、XLSX 可下载，其他类型保留引用。原 ZIP
            请继续保存。每个会话单独保存，取消或空间不足时保留已完成部分，再导入会去重。
          </p>
          <button
            disabled={working || busy || !Object.keys(selected).length}
            onClick={() => void importSelected()}
          >
            导入所选 {Object.keys(selected).length} 个 DeepSeek 会话
          </button>
        </>
      )}
      {working && (
        <button
          onClick={() => {
            stop()
            setProgress('已停止；已完成的会话保留')
            if (!importing) {
              setWorking(false)
              onWorking(false)
            }
          }}
        >
          停止读取 / 导入
        </button>
      )}
    </section>
  )
}
