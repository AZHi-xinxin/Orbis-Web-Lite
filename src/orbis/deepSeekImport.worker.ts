import { DeepSeekArchive } from './deepSeekImport.js'
let archive: DeepSeekArchive | undefined
self.onmessage = async (event: MessageEvent) => {
  const { id, action, file, conversation, leaf, media } = event.data
  try {
    if (action === 'inspect') {
      archive = await DeepSeekArchive.open(file)
      const result = await archive.inspect((done, total) =>
        self.postMessage({ id, progress: { done, total } })
      )
      self.postMessage({ id, result })
    } else if (action === 'prepare' && archive) {
      self.postMessage({ id, result: await archive.prepare(conversation, leaf, media) })
    } else {
      throw Error('请重新选择 DeepSeek 文件')
    }
  } catch (e) {
    self.postMessage({ id, error: e instanceof Error ? e.message : '读取失败，请保留原文件' })
  }
}
