import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'

// Served from the domain root locally; GitHub Pages builds set BASE_PATH=/unpixel/
const base = process.env.BASE_PATH || '/'

// Emits dist/sw.js with the exact list of built files, so the installed app works offline.
const serviceWorker = () => ({
  name: 'unpixel-sw',
  apply: 'build',
  enforce: 'post',
  generateBundle(_, bundle) {
    // public/demo (homepage sample photo and video) is fetched on demand, not precached
    const pub = readdirSync('public', { withFileTypes: true }).filter((e) => e.isFile()).map((e) => base + e.name)
    const files = [base, ...pub, ...Object.keys(bundle).map((f) => base + f)]
    const assets = [...new Set(files)].sort()
    const template = readFileSync('src/sw.js', 'utf8')
    // Hashed file names change with every code change, so the version (and the cache) changes with every deploy
    const version = createHash('sha1').update(assets.join('\n') + template).digest('hex').slice(0, 10)
    const source = template.replace('__VERSION__', version).replace('__BASE__', base).replace('__ASSETS__', JSON.stringify(assets))
    this.emitFile({ type: 'asset', fileName: 'sw.js', source })
  },
})

export default defineConfig(({ mode }) => {
  // The privacy page and the cookie banner only exist for Google Tag Manager: no GTM id, no page published
  const gtm = loadEnv(mode, process.cwd(), '').VITE_GTM_ID
  return {
    base,
    plugins: [react(), serviceWorker()],
    worker: { format: 'es' },
    build: { rollupOptions: { input: { main: 'index.html', ...(gtm ? { confidentialite: 'confidentialite.html' } : {}) } } },
  }
})
