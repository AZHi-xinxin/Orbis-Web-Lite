import { createRoot } from 'react-dom/client'
import { assetUrl, appBase } from './orbis/assets.js'
import { App } from './orbis/App.js'
import { ensureKatex } from './services/markdown/katex.js'

ensureKatex()

createRoot(document.getElementById('root') as HTMLElement).render(<App />)

if ('serviceWorker' in navigator)
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(assetUrl('sw.js'), { scope: appBase }).catch(() => {})
  })
