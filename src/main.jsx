import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import App from './App.jsx'
import '@fontsource-variable/bricolage-grotesque/opsz.css' // self-hosted: no visitor IP sent to Google Fonts
import './styles.css'
import { at } from './base.js'

// Offline support + updates for the installed app (dev keeps no cache, so edits always show up).
// A new deploy changes sw.js; the browser checks it on every launch and here every hour, installs it,
// and 'controllerchange' tells the app a new version is live (ignored on the very first install).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => hadController && dispatchEvent(new Event('unpixel:update')))
  addEventListener('load', async () => {
    const reg = await navigator.serviceWorker.register(at('sw.js'))
    setInterval(() => reg.update(), 60 * 60 * 1000)
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
)
