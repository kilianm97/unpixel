import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

// pdf.js (Firefox's PDF engine) draws the page previews; it takes ownership of the bytes it gets, so it gets a copy.
export async function loadPreview(file) {
  try {
    return await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  } catch (e) {
    throw new Error(
      e?.name === 'PasswordException'
        ? 'Ce PDF est protégé par un mot de passe. Enregistrez-en une copie sans protection, puis déposez-la.'
        : 'Impossible de lire ce PDF. Il est peut-être endommagé.',
    )
  }
}

// One page, drawn when it scrolls into view (a 200-page PDF doesn't draw 200 pages up front)
export function PageThumb({ doc, n, size = 180 }) {
  const canvas = useRef(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const el = canvas.current
    let alive = true
    let task
    const io = new IntersectionObserver(
      async ([entry]) => {
        if (!entry.isIntersecting) return
        io.disconnect()
        try {
          const page = await doc.getPage(n)
          if (!alive) return
          const base = page.getViewport({ scale: 1 })
          const viewport = page.getViewport({ scale: (size * devicePixelRatio) / Math.max(base.width, base.height) })
          el.width = Math.round(viewport.width)
          el.height = Math.round(viewport.height)
          task = page.render({ canvas: el, viewport })
          await task.promise
          if (alive) setReady(true)
        } catch {
          // cancelled or unreadable page: the empty sheet stays
        }
      },
      { rootMargin: '300px' },
    )
    io.observe(el)
    return () => {
      alive = false
      io.disconnect()
      task?.cancel()
    }
  }, [doc, n, size])
  return <canvas ref={canvas} className="page-canvas" data-ready={ready} aria-hidden="true" />
}

export function downloadPdf(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  Object.assign(document.createElement('a'), { href: url, download: name }).click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
