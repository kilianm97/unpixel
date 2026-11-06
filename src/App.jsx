import { Fragment, lazy, Suspense, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, useMotionValue, useMotionValueEvent, useTransform, animate } from 'motion/react'
import { dragRect, spanRect, cropPixels, isFull, FULL } from './crop.js'
import { findQuality, pixelsOf } from './compress.js'
import logoUrl from './logo.svg'
import { HomeSections, InstallIcon } from './Home.jsx'
import { Footer } from './Footer.jsx'
import { CookieBanner } from './CookieBanner.jsx'
import { ColorSwatch } from './ColorPicker.jsx'
import { recolorSvg } from './trace.js'
// mediabunny only loads for the video tool. If a page left open from an older version asks for a chunk
// that a new deploy removed, reload once onto the new version instead of crashing.
const VideoTool = lazy(() =>
  import('./Video.jsx').catch((e) => {
    if (sessionStorage.getItem('unpixel-reloaded')) throw e
    sessionStorage.setItem('unpixel-reloaded', '1')
    location.reload()
    return new Promise(() => {})
  }),
)
import { isVideoFile } from './videoPresets.js'

// Tracing resolution: upscaled with smoothing (at least 4×, and tiny logos up to ~1000 px), 8 megapixels max,
// so thresholding recovers the sub-pixel edge position stored in anti-aliasing: straight edges stay straight, curves stay true.
const workScale = (w, h) => Math.min(Math.max(4, 1000 / Math.max(w, h)), Math.sqrt(8e6 / (w * h)))
// Below this size a logo has lost its fine details: the tracer can only redraw what the pixels still hold
const TINY_LOGO = 300
const MAX_SIDE = 8000 // export size cap: keeps canvases within browser limits
const spring = { type: 'spring', stiffness: 260, damping: 30 }
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

const FORMATS = {
  png: { type: 'image/png', label: 'PNG', ext: 'png', lossy: false },
  jpeg: { type: 'image/jpeg', label: 'JPG', ext: 'jpg', lossy: true },
  webp: { type: 'image/webp', label: 'WebP', ext: 'webp', lossy: true },
}
const formatOf = (type) => Object.keys(FORMATS).find((k) => FORMATS[k].type === type) ?? 'png'
const fmt = (b) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} Ko` : `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`)

async function decode(file) {
  if (!file?.type.startsWith('image/')) throw new Error('Ce fichier n’est pas une image. Utilisez un PNG, JPG ou WebP.')
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.src = url
  try {
    await img.decode()
  } catch {
    URL.revokeObjectURL(url)
    throw new Error('Impossible de lire cette image. Essayez de l’exporter en PNG.')
  }
  if (!img.naturalWidth || !img.naturalHeight) {
    URL.revokeObjectURL(url)
    throw new Error('Cette image n’a pas de dimensions. Exportez-la en PNG.')
  }
  const name = file.name.replace(/\.[^.]+$/, '') || 'image'
  if (file.type === 'image/svg+xml') {
    // An SVG without width/height decodes at a default 150 px and ignores source rectangles in drawImage:
    // render it once, large and sharp, and work from that bitmap like any other image.
    const k = 2000 / Math.max(img.naturalWidth, img.naturalHeight)
    const c = document.createElement('canvas')
    c.width = Math.round(img.naturalWidth * k)
    c.height = Math.round(img.naturalHeight * k)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    URL.revokeObjectURL(url)
    const raster = URL.createObjectURL(await toBlob(c, 'image/png'))
    const bmp = new Image()
    bmp.src = raster
    await bmp.decode()
    return { img: bmp, url: raster, name, bytes: file.size, type: 'image/png' }
  }
  return { img, url, name, bytes: file.size, type: file.type }
}

const region = (img, crop) =>
  crop ? cropPixels(crop, img.naturalWidth, img.naturalHeight) : { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight }

function draw(img, r, w, h, background) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (background) (ctx.fillStyle = background), ctx.fillRect(0, 0, w, h)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, w, h)
  return canvas
}

// [id, label, short label for small screens]
const TOOLS = [
  ['image', 'Optimiser une image', 'Images'],
  ['svg', 'Logo en SVG', 'Logo SVG'],
  ['video', 'Compresser une vidéo', 'Vidéo'],
]
const TOOL_TABS = TOOLS.map(([id, label, short]) => [
  id,
  <>
    <span className="label-long">{label}</span>
    <span className="label-short" aria-hidden="true">
      {short}
    </span>
  </>,
])
const toolFromHash = () => ({ '#svg': 'svg', '#video': 'video' })[location.hash] ?? 'image'

const HERO = {
  image: {
    title: 'Des images légères, sans perte visible.',
    text: 'Rognez, redimensionnez et compressez vos images en JPG ou WebP : unpixel trouve le réglage le plus léger sans différence visible. Vos fichiers ne quittent jamais votre ordinateur.',
    drop: 'Déposez votre image ici',
  },
  svg: {
    title: 'Votre logo, net à toutes les tailles.',
    text: 'Déposez un logo en PNG ou JPG : il devient un fichier SVG que vous pouvez agrandir sans flou. Vos fichiers ne quittent jamais votre ordinateur.',
    drop: 'Déposez votre logo ici',
  },
  video: {
    title: 'Des vidéos légères, prêtes à partager.',
    text: 'Coupez et compressez vos vidéos en MP4, lisible partout. Vos fichiers ne quittent jamais votre ordinateur.',
    drop: 'Déposez votre vidéo ici',
  },
}

const toBlob = (canvas, type, quality) =>
  new Promise((ok, fail) =>
    canvas.toBlob((b) => (b ? ok(b) : fail(new Error('L’export a échoué. Essayez une taille plus petite.'))), type, quality),
  )

// Pixels for the tracer: always the whole image (the logo tool has no crop).
function traceData(img) {
  const r = region(img, null)
  const k = workScale(r.w, r.h)
  const work = draw(img, r, Math.round(r.w * k), Math.round(r.h * k))
  return { w: r.w, h: r.h, imgd: work.getContext('2d').getImageData(0, 0, work.width, work.height) }
}

// Preview of the cropped area for the image tool's before/after view.
const cropPreview = async (img, crop) =>
  URL.createObjectURL(await toBlob(draw(img, region(img, crop), region(img, crop).w, region(img, crop).h), 'image/png'))

function revokeSrc(s) {
  URL.revokeObjectURL(s.fullUrl)
  if (s.url !== s.fullUrl) URL.revokeObjectURL(s.url)
}

export default function App() {
  const [src, setSrc] = useState(null)
  const [recolor, setRecolor] = useState({}) // traced colour → replacement, logo tool only
  const [video, setVideo] = useState(null)
  const [mode, setModeState] = useState(toolFromHash)
  const [opts, setOpts] = useState({ colors: 8, detail: 3, smooth: 2, corners: 2, transparent: true })
  const [out, setOut] = useState({ format: 'png', compression: 'optimal', quality: 80 })
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [result, setResult] = useState(null)
  const [raster, setRaster] = useState(null)
  const [svgDownload, setSvgDownload] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  // Chrome/Edge offer installation through this event; Safari users use "Ajouter au Dock / à l’écran d’accueil".
  const [installPrompt, setInstallPrompt] = useState(null)
  // New version deployed: reload right away when nothing is open, otherwise offer it without losing the work.
  const [update, setUpdate] = useState(false)
  const busyWithFile = useRef(false)
  useEffect(() => {
    sessionStorage.removeItem('unpixel-reloaded')
    const onUpdate = () => (busyWithFile.current ? setUpdate(true) : location.reload())
    addEventListener('unpixel:update', onUpdate)
    return () => removeEventListener('unpixel:update', onUpdate)
  }, [])
  useEffect(() => {
    const onPrompt = (e) => (e.preventDefault(), setInstallPrompt(e))
    const onInstalled = () => setInstallPrompt(null)
    addEventListener('beforeinstallprompt', onPrompt)
    addEventListener('appinstalled', onInstalled)
    return () => (removeEventListener('beforeinstallprompt', onPrompt), removeEventListener('appinstalled', onInstalled))
  }, [])
  async function install() {
    installPrompt.prompt()
    await installPrompt.userChoice
    setInstallPrompt(null)
  }
  const [cropping, setCropping] = useState(false)
  const reqId = useRef(0)
  const svgUrl = useRef(null)
  const fileInput = useRef(null)

  // Opening a tool from the page (footer, "Essayer"): back to that tool's home, at the top
  function pickTool(id) {
    resetRef.current?.() // tools don't share a file
    setMode(id)
    scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' })
  }
  function setMode(m) {
    setModeState(m)
    history.replaceState(null, '', `#${m}`)
  }
  useEffect(() => {
    // Tools don't share an image: changing tool by URL goes back to that tool's home page.
    const onHash = () => (resetRef.current?.(), setModeState(toolFromHash()))
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])

  async function open(file) {
    setError('')
    if (mode === 'video') {
      if (!isVideoFile(file)) return setError('Ce fichier n’est pas une vidéo. Utilisez un MP4, MOV, MKV ou WebM.')
      return setVideo((prev) => (prev && URL.revokeObjectURL(prev.url), { file, url: URL.createObjectURL(file), name: file.name }))
    }
    try {
      const d = await decode(file)
      const p = traceData(d.img)
      setSrc(
        (prev) => (
          prev && revokeSrc(prev),
          { name: d.name, img: d.img, fullUrl: d.url, url: d.url, bytes: d.bytes, crop: null, w: p.w, h: p.h, imgd: p.imgd }
        ),
      )
      setSize({ w: p.w, h: p.h })
      setOut((o) => ({ ...o, format: formatOf(d.type) }))
      setRecolor({})
      setResult(null)
      setRaster(null)
      setCropping(false)
    } catch (e) {
      setError(e.message)
    }
  }

  async function applyCrop(rect) {
    setCropping(false)
    const crop = isFull(rect) ? null : rect
    const url = crop ? await cropPreview(src.img, crop) : src.fullUrl
    if (src.url !== src.fullUrl) URL.revokeObjectURL(src.url)
    const r = region(src.img, crop)
    setSrc({ ...src, crop, url })
    setSize({ w: r.w, h: r.h })
    setRaster(null)
  }

  const resetRef = useRef(null)
  const loaded = mode === 'video' ? video : src
  busyWithFile.current = !!loaded
  resetRef.current = loaded ? reset : null
  function reset() {
    if (video) URL.revokeObjectURL(video.url), setVideo(null)
    if (!src) return
    revokeSrc(src)
    stopTrace()
    reqId.current++
    setSrc(null)
    setRecolor({})
    setResult(null)
    setRaster(null)
    setBusy(false)
    setCropping(false)
  }

  // One trace at a time: a new request kills the one in flight (potrace can't be interrupted from inside).
  const worker = useRef(null)
  const inFlight = useRef(false)
  function stopTrace() {
    if (!inFlight.current) return
    worker.current?.terminate()
    worker.current = null
    inFlight.current = false
  }
  function trace(msg) {
    stopTrace()
    if (!worker.current) {
      worker.current = new Worker(new URL('./trace.worker.js', import.meta.url), { type: 'module' })
      worker.current.onmessage = ({ data }) => {
        inFlight.current = false
        if (data.id !== reqId.current) return // a newer request is on its way
        setBusy(false)
        if (data.tooComplex)
          return setError(
            'Cette image est trop détaillée pour un SVG propre. Cet outil est fait pour les logos et illustrations simples : pour une photo, utilisez « Optimiser une image ».',
          )
        if (data.error) return setError(`La vectorisation a échoué : ${data.error}`)
        if (svgUrl.current) URL.revokeObjectURL(svgUrl.current)
        svgUrl.current = URL.createObjectURL(new Blob([data.svg], { type: 'image/svg+xml' }))
        setResult({ ...data, url: svgUrl.current })
      }
    }
    inFlight.current = true
    worker.current.postMessage(msg)
  }

  useEffect(() => {
    const onPaste = (e) => e.clipboardData?.files[0] && open(e.clipboardData.files[0])
    addEventListener('paste', onPaste)
    return () => removeEventListener('paste', onPaste)
  }, [])

  // Vector: trace in the worker
  useEffect(() => {
    if (!src || mode !== 'svg') return
    const id = ++reqId.current
    setBusy(true)
    setError('')
    const t = setTimeout(() => trace({ id, imgd: src.imgd, opts: { ...opts, outW: src.w, outH: src.h } }), 180)
    return () => clearTimeout(t)
  }, [src, opts, mode])

  // Image: crop + resize + encode on a canvas
  useEffect(() => {
    if (!src || mode !== 'image' || !size.w || !size.h) return
    reqId.current++ // drops any trace still running
    stopTrace()
    let cancelled = false
    let url
    setBusy(true)
    setError('')
    const t = setTimeout(async () => {
      try {
        const f = FORMATS[out.format]
        const canvas = draw(src.img, region(src.img, src.crop), size.w, size.h, f.type === 'image/jpeg' ? '#fff' : null)
        const encode = (q) => toBlob(canvas, f.type, q / 100)
        let blob, q
        if (!f.lossy) blob = await toBlob(canvas, f.type)
        else if (out.compression === 'none') blob = await encode(100)
        else if (out.compression === 'manual') blob = await encode((q = out.quality))
        else {
          const ref = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
          const found = await findQuality(encode, (b) => pixelsOf(b, canvas.width, canvas.height), ref, { cancelled: () => cancelled })
          if (!found) return
          ;({ blob, q } = found)
        }
        if (cancelled) return
        if (blob.type !== f.type) throw new Error(`Votre navigateur ne sait pas créer de ${f.label}. Choisissez un autre format.`)
        url = URL.createObjectURL(blob)
        setRaster({ url, bytes: blob.size, q })
      } catch (e) {
        if (!cancelled) setError(e.message)
      }
      if (!cancelled) setBusy(false)
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(t)
      if (url) URL.revokeObjectURL(url)
    }
  }, [src, mode, out, size])

  const finalSvg = result && recolorSvg(result.svg, recolor)
  useEffect(() => {
    if (!finalSvg) return setSvgDownload(null)
    const u = URL.createObjectURL(new Blob([finalSvg], { type: 'image/svg+xml' }))
    setSvgDownload(u)
    return () => URL.revokeObjectURL(u)
  }, [finalSvg])

  const dropProps = {
    onDragOver: (e) => (e.preventDefault(), setDragging(true)),
    onDragLeave: (e) => e.currentTarget.contains(e.relatedTarget) || setDragging(false),
    onDrop: (e) => (e.preventDefault(), setDragging(false), open(e.dataTransfer.files[0])),
  }

  const brand = <img src={logoUrl} alt="unpixel" className="logo" width="132" height="30" />

  return (
    <div className="app" {...dropProps}>
      <header className="bar">
        {loaded ? (
          <button className="brand" onClick={reset} aria-label="unpixel, retour à l’accueil">
            {brand}
          </button>
        ) : (
          <span className="brand">{brand}</span>
        )}
        {loaded ? (
          <span className="tool-name">{TOOLS.find(([k]) => k === mode)[1]}</span>
        ) : (
          <nav className="tools" aria-label="Outils">
            <Segmented label="Outil" value={mode} onChange={setMode} options={TOOL_TABS} />
          </nav>
        )}
        {loaded ? (
          <button className="ghost" onClick={() => fileInput.current.click()}>
            {mode === 'video' ? 'Changer de vidéo' : 'Changer d’image'}
          </button>
        ) : (
          installPrompt && (
            <motion.button
              className="ghost install"
              onClick={install}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              whileTap={{ scale: 0.96 }}
            >
              <InstallIcon /> Installer l’app
            </motion.button>
          )
        )}
      </header>

      <input
        ref={fileInput}
        type="file"
        accept={mode === 'video' ? 'video/*,.mkv,.mov,.avi,.flv,.wmv' : 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml'}
        hidden
        onChange={(e) => (open(e.target.files[0]), (e.target.value = ''))}
      />

      <AnimatePresence mode="wait">
        {!loaded ? (
          <motion.main key="home" className="home" exit={{ opacity: 0, y: -16 }} transition={{ duration: 0.25 }}>
            <section className="hero">
              <AnimatePresence mode="wait">
                <motion.div
                  key={mode}
                  className="intro"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.2 }}
                >
                  <h1 aria-label={HERO[mode].title}>
                    {HERO[mode].title.split(' ').map((word, i) => (
                      <Fragment key={i}>
                        <span className="word" aria-hidden="true">
                          <motion.span
                            initial={{ y: '105%' }}
                            animate={{ y: 0 }}
                            transition={{ duration: reduced() ? 0 : 0.7, ease: [0.16, 1, 0.3, 1], delay: reduced() ? 0 : 0.05 + i * 0.07 }}
                          >
                            {word}
                          </motion.span>
                        </span>{' '}
                      </Fragment>
                    ))}
                  </h1>
                  <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: reduced() ? 0 : 0.45 }}>
                    {HERO[mode].text}
                  </motion.p>
                </motion.div>
              </AnimatePresence>
              <DropZone dragging={dragging} onClick={() => fileInput.current.click()}>
                {mode === 'svg' ? <Curve key="svg" /> : mode === 'video' ? <Reel key="video" /> : <CropMarks key="image" />}
                <span className="drop-title">{dragging ? 'Lâchez pour ouvrir' : HERO[mode].drop}</span>
                <span className="drop-hint">
                  {mode === 'video'
                    ? 'ou cliquez pour choisir un fichier MP4, MOV, MKV ou WebM.'
                    : 'ou cliquez pour choisir un fichier. Vous pouvez aussi coller une image avec Ctrl+V.'}
                </span>
              </DropZone>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </section>
            <HomeSections mode={mode} onPick={pickTool} />
          </motion.main>
        ) : mode === 'video' ? (
          <Suspense key={video.url} fallback={<main className="work" aria-busy="true" />}>
            <VideoTool video={video} />
          </Suspense>
        ) : (
          <motion.main key="work" className="work" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
            {cropping && mode === 'image' ? (
              <Cropper
                url={src.fullUrl}
                initial={src.crop ?? FULL}
                natural={{ w: src.img.naturalWidth, h: src.img.naturalHeight }}
                onApply={applyCrop}
                onCancel={() => setCropping(false)}
              />
            ) : (
              <Compare
                key={(mode === 'svg' ? src.fullUrl : src.url) + mode}
                original={mode === 'svg' ? src.fullUrl : src.url}
                output={mode === 'svg' ? svgDownload : raster?.url}
                label={mode === 'svg' ? 'Vecteur' : 'Résultat'}
                busy={busy}
                busyText={mode === 'svg' ? 'Vectorisation…' : 'Export…'}
              />
            )}
            <Panel
              {...{ mode, opts, setOpts, out, setOut, size, setSize, result, raster, src, error, busy }}
              svg={finalSvg}
              recolor={recolor}
              onRecolor={(from, to) => setRecolor(({ [from]: _, ...m }) => (to === from ? m : { ...m, [from]: to }))}
              svgDownload={svgDownload}
              onCrop={() => setCropping(true)}
            />
          </motion.main>
        )}
      </AnimatePresence>

      <Footer onInstall={installPrompt ? install : null} onPickTool={pickTool} />
      <CookieBanner />

      <AnimatePresence>
        {update && (
          <motion.div
            className="update"
            role="status"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={spring}
          >
            <span>Une nouvelle version d’unpixel est disponible.</span>
            <button className="primary small" onClick={() => location.reload()}>
              Recharger
            </button>
            <button className="link" onClick={() => setUpdate(false)}>
              Plus tard
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// The drop zone leans toward the pointer (3D tilt) and settles back on leave.
function DropZone({ dragging, onClick, children }) {
  return (
    <motion.button
      className="drop"
      data-dragging={dragging}
      onClick={onClick}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: dragging ? 1.02 : 1 }}
      whileTap={{ scale: 0.985 }}
      transition={spring}
    >
      {children}
    </motion.button>
  )
}

function Compare({ original, output, label, busy, busyText }) {
  const pos = useMotionValue(100) // % of the width showing the original
  const clip = useTransform(pos, (p) => `inset(0 0 0 ${p}%)`)
  const clipOriginal = useTransform(pos, (p) => `inset(0 ${100 - p}% 0 0)`) // so a transparent output doesn't show the original through
  const left = useTransform(pos, (p) => `${p}%`)
  const range = useRef(null)
  const revealed = useRef(false)

  useMotionValueEvent(pos, 'change', (v) => range.current && (range.current.value = v))
  useEffect(() => {
    if (!output || revealed.current) return
    revealed.current = true
    reduced() ? pos.set(50) : animate(pos, 50, { duration: 1.1, ease: [0.65, 0, 0.35, 1] })
  }, [output])

  return (
    <section className="stage" aria-label="Aperçu">
      <motion.img src={original} className="layer" style={{ clipPath: clipOriginal }} alt="Image d’origine" draggable="false" />
      {output && <motion.img src={output} className="layer" style={{ clipPath: clip }} alt={label} draggable="false" />}
      {output && (
        <motion.div className="divider" style={{ left }} aria-hidden="true">
          <span className="knob">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path d="M9 6l-5 6 5 6M15 6l5 6-5 6" />
            </svg>
          </span>
        </motion.div>
      )}
      <input
        ref={range}
        className="scrub"
        type="range"
        min="0"
        max="100"
        step="0.1"
        defaultValue="100"
        disabled={!output}
        aria-label={`Comparer l’original et le ${label.toLowerCase()}`}
        onChange={(e) => pos.set(+e.target.value)}
      />
      <span className="tag tag-l">Original</span>
      <span className="tag tag-r">{label}</span>
      <AnimatePresence>
        {busy && (
          <motion.span className="status" role="status" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <span className="spinner" /> {busyText}
          </motion.span>
        )}
      </AnimatePresence>
    </section>
  )
}

function Cropper({ url, initial, natural, onApply, onCancel }) {
  const [r, setR] = useState(initial)
  const wrap = useRef(null)
  const drag = useRef(null)
  const point = (e) => {
    const b = wrap.current.getBoundingClientRect()
    return { x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height }
  }
  const start = (mode) => (e) => {
    e.stopPropagation()
    e.preventDefault()
    wrap.current.setPointerCapture(e.pointerId)
    drag.current = { mode, p0: point(e), r0: r }
  }
  const move = (e) => {
    const d = drag.current
    if (!d) return
    const p = point(e)
    setR(d.mode === 'new' ? spanRect(d.p0, p) : dragRect(d.mode, d.r0, p.x - d.p0.x, p.y - d.p0.y))
  }
  const end = () => (drag.current = null)
  const onKey = (e) => {
    const s = e.shiftKey ? 0.05 : 0.01
    const d = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] }[e.key]
    if (!d) return
    e.preventDefault()
    setR((r) => dragRect(e.altKey ? 'se' : 'move', r, ...d))
  }
  const px = cropPixels(r, natural.w, natural.h)
  const [x1, y1, x2, y2] = [r.x, r.y, r.x + r.w, r.y + r.h].map((v) => `${v * 100}%`)

  return (
    <section className="stage cropper" aria-label="Rogner l’image">
      <div className="crop-area">
        <div ref={wrap} className="crop-wrap" onPointerDown={start('new')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
          <img src={url} alt="Image à rogner" draggable="false" />
          <div
            className="crop-shade"
            style={{
              clipPath: `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${x1} ${y1}, ${x2} ${y1}, ${x2} ${y2}, ${x1} ${y2}, ${x1} ${y1})`,
            }}
          />
          <div
            className="crop-rect"
            style={{ left: x1, top: y1, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
            onPointerDown={start('move')}
            onKeyDown={onKey}
            tabIndex={0}
            role="group"
            aria-label="Zone gardée. Flèches pour déplacer, Alt + flèches pour redimensionner."
          >
            {['nw', 'ne', 'sw', 'se'].map((c) => (
              <span key={c} className={`crop-handle ${c}`} onPointerDown={start(c)} />
            ))}
          </div>
        </div>
      </div>
      <div className="crop-bar">
        <span className="crop-size">
          {px.w} × {px.h} px
        </span>
        <button className="ghost" onClick={() => setR(FULL)}>
          Image entière
        </button>
        <button className="ghost" onClick={onCancel}>
          Annuler
        </button>
        <motion.button className="primary small" onClick={() => onApply(r)} whileTap={{ scale: 0.97 }}>
          Rogner
        </motion.button>
      </div>
    </section>
  )
}

function Panel({
  mode,
  opts,
  setOpts,
  out,
  setOut,
  size,
  setSize,
  result,
  raster,
  src,
  error,
  busy,
  svg,
  svgDownload,
  onCrop,
  recolor,
  onRecolor,
}) {
  const [copied, setCopied] = useState('')
  const set = (k) => (e) => setOpts((o) => ({ ...o, [k]: e.target.type === 'checkbox' ? e.target.checked : +e.target.value }))
  const f = FORMATS[out.format]
  const isSvg = mode === 'svg'
  const download = isSvg ? svgDownload : raster?.url
  const ready = !!download && !busy

  async function copy(text, what) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      setTimeout(() => setCopied(''), 1600)
    } catch {
      setCopied('error')
    }
  }

  function setDim(dim, value) {
    const v = value === '' ? '' : Math.min(MAX_SIDE, Math.max(1, Math.round(+value) || 1))
    const r = region(src.img, src.crop)
    const ratio = r.h / r.w
    setSize(dim === 'w' ? { w: v, h: v && Math.max(1, Math.round(v * ratio)) } : { h: v, w: v && Math.max(1, Math.round(v / ratio)) })
  }

  const outBytes = busy ? null : isSvg ? svg?.length : raster?.bytes
  const gain = outBytes ? Math.round((1 - outBytes / src.bytes) * 100) : null
  // A heavier result is not a "gain": say why, and what to change
  const heavierWhy = () => {
    if (isSvg) return 'Plus lourd que l’image d’origine, mais net à toutes les tailles : c’est le propre d’un fichier vectoriel.'
    if (!f.lossy) return 'Le PNG est sans perte : choisissez WebP pour un fichier plus léger.'
    if (out.compression === 'none') return 'Sans compression, le fichier grossit : choisissez « Optimale ».'
    const r = region(src.img, src.crop)
    if (size.w * size.h > r.w * r.h) return 'L’image est agrandie, donc plus lourde : réduisez la taille.'
    return 'L’original est déjà très compressé. Essayez le WebP, souvent plus léger à qualité égale.'
  }

  return (
    <aside className="panel">
      <div>
        <h2 className="file" title={src.name}>
          {src.name}
        </h2>
        <div className="gain" aria-live="polite">
          {gain === null ? (
            busy && <span className="gain-wait">Calcul en cours…</span>
          ) : (
            <>
              <strong data-worse={gain <= 0}>{gain > 0 ? `−${gain} %` : fmt(outBytes)}</strong>
              <span>
                {gain > 0 ? `${fmt(src.bytes)} → ${fmt(outBytes)}` : `au lieu de ${fmt(src.bytes)}`}
                {isSvg && result && (
                  <>
                    , {result.paths} forme{result.paths > 1 ? 's' : ''}
                  </>
                )}
              </span>
            </>
          )}
        </div>
        {gain !== null && gain <= 0 && <p className="hint gain-why">{heavierWhy()}</p>}
      </div>

      {!isSvg && (
        <>
          <button className="ghost crop-btn" onClick={onCrop}>
            {src.crop ? 'Modifier le rognage' : 'Rogner l’image'}
          </button>

          <fieldset className="size">
            <legend>Taille</legend>
            <div className="size-row">
              <label>
                Largeur (px)
                <input type="number" min="1" max={MAX_SIDE} value={size.w} onChange={(e) => setDim('w', e.target.value)} />
              </label>
              <span aria-hidden="true">×</span>
              <label>
                Hauteur (px)
                <input type="number" min="1" max={MAX_SIDE} value={size.h} onChange={(e) => setDim('h', e.target.value)} />
              </label>
            </div>
            <span className="hint">Les proportions sont gardées.</span>
          </fieldset>
        </>
      )}

      {isSvg ? (
        <>
          <Slider
            label="Couleurs max"
            value={opts.colors}
            min={1}
            max={16}
            onChange={set('colors')}
            hint="Seules les couleurs vraiment présentes sont gardées."
          />
          <Slider
            label="Précision"
            value={opts.detail}
            min={1}
            max={5}
            onChange={set('detail')}
            hint="Bas : ignore les petites taches. Haut : garde chaque détail."
          />
          <Slider
            label="Lissage"
            value={opts.smooth}
            min={0}
            max={4}
            onChange={set('smooth')}
            hint="Efface les petites bosses du contour."
          />
          <Slider
            label="Angles"
            value={opts.corners}
            min={0}
            max={4}
            onChange={set('corners')}
            hint="Bas : angles vifs. Haut : courbes arrondies."
          />
          <Switch checked={opts.transparent} onChange={set('transparent')} label="Fond transparent" />
          {result?.palette.length > 0 && (
            <div className="field">
              <span className="field-label">Couleurs</span>
              <div className="palette" aria-label="Couleurs du logo">
                {result.palette.map((c) => (
                  <ColorSwatch key={c} original={c} value={recolor[c] ?? c} onChange={(v) => onRecolor(c, v)} />
                ))}
              </div>
              <span className="hint">Cliquez sur une couleur pour la remplacer.</span>
            </div>
          )}
          {result?.paths === 0 && (
            <p className="error" role="alert">
              Aucune forme trouvée. Désactivez « Fond transparent » ou ajoutez des couleurs.
            </p>
          )}
          {Math.max(src.w, src.h) < TINY_LOGO && (
            <p className="notice">
              Image très petite ({src.w} × {src.h} px) : les détails fins ne peuvent pas être retrouvés. Pour un tracé net, utilisez une
              version d’au moins {TINY_LOGO} px de large.
            </p>
          )}
        </>
      ) : (
        <>
          <div className="field">
            <span className="field-label">Format</span>
            <Segmented
              label="Format"
              value={out.format}
              onChange={(format) => setOut((o) => ({ ...o, format }))}
              options={Object.entries(FORMATS).map(([k, v]) => [k, v.label])}
            />
          </div>
          {f.lossy ? (
            <div className="field">
              <span className="field-label">Compression</span>
              <Segmented
                label="Compression"
                value={out.compression}
                onChange={(compression) => setOut((o) => ({ ...o, compression }))}
                options={[
                  ['none', 'Aucune'],
                  ['optimal', 'Optimale'],
                  ['manual', 'Manuelle'],
                ]}
              />
              <span className="hint">
                {out.compression === 'none' && 'Qualité maximale, fichier le plus lourd.'}
                {out.compression === 'optimal' &&
                  (raster?.q && !busy
                    ? `Qualité ${raster.q} choisie automatiquement : aucune différence visible avec l’original.`
                    : 'Recherche du réglage le plus léger sans différence visible…')}
                {out.compression === 'manual' && 'Choisissez vous-même le compromis poids et qualité.'}
              </span>
            </div>
          ) : (
            <span className="hint">Le PNG est sans perte. Pour réduire le poids sans différence visible, choisissez WebP.</span>
          )}
          {f.lossy && out.compression === 'manual' && (
            <Slider
              label="Qualité"
              value={out.quality}
              min={10}
              max={95}
              step={5}
              onChange={(e) => setOut((o) => ({ ...o, quality: +e.target.value }))}
              hint="En dessous de 70, la perte devient visible."
            />
          )}
          {f.type === 'image/jpeg' && (
            <span className="hint">
              Le JPG ne gère pas la transparence : le fond devient blanc. Le WebP est souvent bien plus léger, à qualité égale.
            </span>
          )}
        </>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="actions">
        <motion.a
          className="primary"
          href={ready ? download : undefined}
          download={`${src.name}.${isSvg ? 'svg' : f.ext}`}
          aria-disabled={!ready}
          onClick={(e) => ready || e.preventDefault()}
          whileTap={{ scale: 0.97 }}
        >
          Télécharger le {isSvg ? 'SVG' : f.label}
        </motion.a>
        {isSvg && (
          <motion.button className="secondary" disabled={!svg} onClick={() => copy(svg, 'code')} whileTap={{ scale: 0.97 }}>
            {copied === 'code' ? 'Code copié' : 'Copier le code SVG'}
          </motion.button>
        )}
      </div>
      <p className="toast" role="status">
        {copied === 'error' ? 'Le presse-papiers est bloqué par le navigateur.' : copied && copied !== 'code' ? `${copied} copié` : ''}
      </p>
    </aside>
  )
}

function Segmented({ label, value, options, onChange }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className="seg-opt" onClick={() => onChange(v)}>
          {value === v && <motion.span layoutId={`seg-${label}`} className="seg-pill" transition={spring} />}
          <span className="seg-text">{text}</span>
        </button>
      ))}
    </div>
  )
}

function Switch({ checked, onChange, label, hint, disabled }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
      <span className="track">
        <motion.span className="thumb" layout transition={spring} />
      </span>
      <span>
        {label}
        {hint && <span className="hint switch-hint">{hint}</span>}
      </span>
    </label>
  )
}

function Slider({ label, hint, value, ...props }) {
  return (
    <label className="slider">
      <span className="slider-head">
        {label} <output>{value}</output>
      </span>
      <input type="range" value={value} {...props} style={{ '--p': `${((value - props.min) / (props.max - props.min)) * 100}%` }} />
      <span className="hint">{hint}</span>
    </label>
  )
}

// Crop marks closing in on a frame: the image tool's job in one gesture.
function CropMarks() {
  const corner = (d, delay) => (
    <motion.path
      d={d}
      className="stroke"
      initial={{ pathLength: 0, opacity: 0 }}
      animate={{ pathLength: 1, opacity: 1 }}
      transition={{ duration: reduced() ? 0 : 0.7, delay: reduced() ? 0 : delay, ease: [0.65, 0, 0.35, 1] }}
    />
  )
  return (
    <svg className="curve" viewBox="0 0 240 140" aria-hidden="true">
      <motion.rect
        x="62"
        y="28"
        width="116"
        height="84"
        rx="6"
        className="frame"
        initial={{ opacity: 0, scale: 1.25 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ ...spring, delay: reduced() ? 0 : 0.5 }}
        style={{ originX: '50%', originY: '50%' }}
      />
      {corner('M50 46 V16 H80', 0.1)}
      {corner('M160 16 H190 V46', 0.2)}
      {corner('M190 94 V124 H160', 0.3)}
      {corner('M80 124 H50 V94', 0.4)}
    </svg>
  )
}

// A bézier curve with its anchors and handles: what tracing actually produces.
function Curve() {
  const draw = (delay) => ({
    initial: { pathLength: 0, opacity: 0 },
    animate: { pathLength: 1, opacity: 1 },
    transition: { duration: reduced() ? 0 : 1.2, delay: reduced() ? 0 : delay, ease: [0.65, 0, 0.35, 1] },
  })
  const pop = (delay) => ({
    initial: { scale: 0 },
    animate: { scale: 1 },
    transition: { ...spring, delay: reduced() ? 0 : delay },
  })
  return (
    <svg className="curve" viewBox="0 0 240 140" aria-hidden="true">
      <motion.path d="M30 110 L80 20" className="handle" {...draw(0.9)} />
      <motion.path d="M210 110 L160 20" className="handle" {...draw(0.9)} />
      <motion.path d="M30 110 C80 20 160 20 210 110" className="stroke" {...draw(0.15)} />
      {[
        [30, 110],
        [210, 110],
      ].map(([x, y], i) => (
        <motion.rect
          key={i}
          x={x - 7}
          y={y - 7}
          width="14"
          height="14"
          rx="3"
          className="anchor"
          {...pop(0.2 + i * 0.9)}
          style={{ originX: '50%', originY: '50%' }}
        />
      ))}
      {[
        [80, 20],
        [160, 20],
      ].map(([x, y], i) => (
        <motion.circle key={i} cx={x} cy={y} r="6" className="ctrl" {...pop(1.6 + i * 0.1)} />
      ))}
    </svg>
  )
}

// A film strip with two trim handles closing in: the video tool in one gesture.
function Reel() {
  const frames = [0, 1, 2, 3, 4]
  return (
    <svg className="curve" viewBox="0 0 240 140" aria-hidden="true">
      {frames.map((i) => (
        <motion.rect
          key={i}
          x={22 + i * 40}
          y="42"
          width="34"
          height="56"
          rx="5"
          className="frame"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: reduced() ? 0 : 0.08 * i }}
        />
      ))}
      <motion.path
        d="M66 34 V106"
        className="stroke"
        initial={{ x: -44, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ ...spring, delay: reduced() ? 0 : 0.6 }}
      />
      <motion.path
        d="M178 34 V106"
        className="stroke"
        initial={{ x: 44, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ ...spring, delay: reduced() ? 0 : 0.7 }}
      />
      <motion.circle
        cx="122"
        cy="70"
        r="6"
        className="ctrl"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ ...spring, delay: reduced() ? 0 : 1 }}
      />
    </svg>
  )
}
