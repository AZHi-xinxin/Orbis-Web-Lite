import { useState } from 'react'
import type { State } from './core.js'
import { speechSettings, type SpeechSettings } from './speech.js'
import { saveSecret, secret } from './storage.js'
export function SpeechPanel({
  settings,
  change,
  fail,
}: {
  settings: State['settings']
  change: (fn: (s: State) => void) => Promise<void>
  fail: (e: unknown) => void
}) {
  const cfg = speechSettings(settings)
  const [asrKey, setAsrKey] = useState(() => secret('asr')),
    [ttsKey, setTtsKey] = useState(() => secret('tts'))
  const set = (key: keyof SpeechSettings, value: unknown) =>
    void change((s) => {
      s.settings.speech = { ...speechSettings(s.settings), [key]: value }
    })
  return (
    <div className="speech-settings">
      <h3>语音与电话</h3>
      <p className="subtle">
        语音在前台运行。录音先经 ASR 转文字，再发送聊天；AI 回答可用系统朗读或 DeepSeek TTS
        播放。DeepSeek 语音按服务用量计费。
      </p>
      <label>
        语音识别服务
        <select value="deepseek" disabled>
          <option value="deepseek">DeepSeek ASR</option>
        </select>
      </label>
      <label>
        ASR 基础地址
        <input value={cfg.asrEndpoint} onChange={(e) => set('asrEndpoint', e.target.value)} />
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={cfg.asrReuseModelKey}
          onChange={(e) => set('asrReuseModelKey', e.target.checked)}
        />
        ASR 复用聊天 API Key（同一服务地址）
      </label>
      {!cfg.asrReuseModelKey && (
        <label>
          ASR API Key
          <input
            type="password"
            autoComplete="off"
            value={asrKey}
            onChange={(e) => {
              try {
                saveSecret('asr', e.target.value)
                setAsrKey(e.target.value)
              } catch (error) {
                fail(error)
              }
            }}
          />
        </label>
      )}
      <label>
        回复朗读
        <select
          aria-label="回复朗读服务"
          value={cfg.ttsProvider}
          onChange={(e) => set('ttsProvider', e.target.value)}
        >
          <option value="browser">浏览器系统朗读</option>
          <option value="deepseek">DeepSeek TTS</option>
        </select>
      </label>
      {cfg.ttsProvider === 'deepseek' && (
        <>
          <label>
            TTS 基础地址
            <input value={cfg.ttsEndpoint} onChange={(e) => set('ttsEndpoint', e.target.value)} />
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={cfg.ttsReuseModelKey}
              onChange={(e) => set('ttsReuseModelKey', e.target.checked)}
            />
            TTS 复用聊天 API Key（同一服务地址）
          </label>
          {!cfg.ttsReuseModelKey && (
            <label>
              TTS API Key
              <input
                type="password"
                autoComplete="off"
                value={ttsKey}
                onChange={(e) => {
                  try {
                    saveSecret('tts', e.target.value)
                    setTtsKey(e.target.value)
                  } catch (error) {
                    fail(error)
                  }
                }}
              />
            </label>
          )}
          <label>
            音色
            <select
              aria-label="DeepSeek TTS 音色"
              value={cfg.voice}
              onChange={(e) => set('voice', e.target.value)}
            >
              <option value="stella">Stella · 女声</option>
              <option value="tide">Tide · 男声</option>
            </select>
          </label>
        </>
      )}
      <label className="toggle">
        <input
          type="checkbox"
          checked={cfg.autoSend}
          onChange={(e) => set('autoSend', e.target.checked)}
        />
        通话中说完停顿后自动发送
      </label>
      <p className="subtle">
        每段最长 120 秒。通话是你说一句、AI
        回一句；可以手动结束本句、打断朗读或挂断。锁屏、切后台或微信限制权限时可能暂停。
      </p>
    </div>
  )
}
