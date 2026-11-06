// Service worker template: vite.config.js fills in the version and the asset list at build time.
// Everything the app needs is precached, so the installed app works offline.
const CACHE = 'unpixel-__VERSION__'
const BASE = '__BASE__' // where the site is served from
const ASSETS = __ASSETS__

self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())))

self.addEventListener('activate', (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('unpixel-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  ),
)

// "Partager vers unpixel" (manifest share_target): keep the files in a cache the page reads on ?shared.
// Not named unpixel-… so a new version's activation doesn't wipe it.
async function receiveShare(request) {
  // A real share is started by the browser (none / same-origin): another site posting here is ignored
  if (request.headers.get('sec-fetch-site') === 'cross-site') return Response.redirect(new URL(BASE, location.origin).href, 303)
  const files = (await request.formData()).getAll('files').filter((f) => f instanceof File).slice(0, 50)
  await caches.delete('share-inbox')
  const inbox = await caches.open('share-inbox')
  await Promise.all(
    files.map((f, i) =>
      inbox.put(`${BASE}share-inbox/${i}`, new Response(f, { headers: { 'content-type': f.type, 'x-name': encodeURIComponent(f.name) } })),
    ),
  )
  return Response.redirect(new URL(`${BASE}?shared=${files.length}`, location.origin).href, 303)
}

self.addEventListener('fetch', (e) => {
  const { request } = e
  if (request.method === 'POST' && new URL(request.url).pathname === BASE + 'share') return e.respondWith(receiveShare(request))
  if (request.method !== 'GET') return
  // Pages: network first, revalidated past the HTTP cache so a new deploy always arrives; cached copy when offline
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request.url, { cache: 'no-cache' }).catch(() => caches.match(request.url, { ignoreSearch: true }).then((hit) => hit || caches.match(BASE + 'index.html'))),
    )
    return
  }
  const url = new URL(request.url)
  if (url.origin !== location.origin) return // never cache or proxy third parties (e.g. Google Tag Manager)
  if (request.headers.has('range')) return // video streaming: partial responses can't be cached
  // Assets (hashed file names): cache first, filled on first use
  e.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          if (res.ok || res.type === 'opaque') {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(request, copy))
          }
          return res
        }),
    ),
  )
})
