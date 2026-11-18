import { useState } from 'react'
import { copyText } from '../utils/clipboard.js'

const technicalMail = 'azhixinxin@agent.qq.com'
const backupMail = 'azhi0226xin@agent.qq.com'
const issuesUrl = 'https://github.com/AZHi-xinxin/Orbis-Web-Lite/issues'

export function FeedbackPanel() {
  const [notice, setNotice] = useState('')
  const version = document.querySelector<HTMLMetaElement>('meta[name="application-version"]')?.content
  const subject = encodeURIComponent(`Orbis Web Lite${version ? ` ${version}` : ''} 问题反馈`)
  return <div className="feedback-panel">
    <p>使用中遇到问题，可以发邮件，也可以在 GitHub 提交反馈。</p>
    {version && <p className="info">当前版本：{version}</p>}
    {[['技术邮箱', technicalMail], ['备用技术邮箱', backupMail]].map(([label, address]) =>
      <div className="feedback-contact" key={address}>
        <strong>{label}</strong>
        <a href={`mailto:${address}?subject=${subject}`}>{address}</a>
        <button onClick={async () => setNotice(await copyText(address)
          ? `${label}已复制` : '未能自动复制，请长按或选中邮箱地址复制。')}>复制{label}</button>
      </div>
    )}
    <p className="info">点击邮箱可打开邮件应用；微信内没有打开时，可复制地址到自己的邮箱。备用邮箱可在主邮箱无法联系时使用。</p>
    <p><a href={issuesUrl} target="_blank" rel="noopener noreferrer">GitHub 问题反馈 ↗</a></p>
    <p>反馈时请说明手机或电脑型号、浏览器、操作步骤和完整报错。若方便，可附上问题截图。</p>
    <p className="info">GitHub 反馈公开可见；请勿附 API Key、密码或私人聊天，截图中相关内容请先遮挡。</p>
    <p role="status" aria-live="polite">{notice}</p>
  </div>
}
