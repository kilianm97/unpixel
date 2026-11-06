import { Fragment, lazy, Suspense, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, useMotionValue, useMotionValueEvent, useTransform, animate } from 'motion/react'
import { cropPixels, isFull, FULL } from './crop.js'
import { Cropper } from './Cropper.jsx'
import { FORMATS, formatOf, fmt, draw, toBlob, exportImage, decode, MAX_SIDE } from './imageExport.js'
import { Batch } from './Batch.jsx'
import logoUrl from './logo.svg'
import { HomeSections, InstallIcon } from './Home.jsx'
import { Footer } from './Footer.jsx'
import { Segmented, Switch, Slider } from './ui.jsx'
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
const spring = { type: 'spring', stiffness: 260, damping: 30 }
const SHARE_INBOX = 'share-inbox' // filled by sw.js on "Partager vers unpixel"
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches


const region = (img, crop) =>
  crop ? cropPixels(crop, img.naturalWidth, img.naturalHeight) : { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight }


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
    drop: 'Déposez vos images ici',
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
  const [batch, setBatch] = useState(null) // several images processed together: [{ id, file, url }]
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
  // Installed app (own window): just the tools. The presentation, FAQ and footer are for the website.
  const [installedApp] = useState(() => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true)
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

  // Entry point for every way files arrive (picker, drop, paste, "Ouvrir avec", share). forMode: the tool to open them in.
  function openFiles(list, forMode = mode) {
    const files = [...list]
    if (!files.length) return
    if (forMode !== mode) resetRef.current?.(), setMode(forMode)
    if (forMode === 'image' && (files.length > 1 || batch)) {
      const images = files.filter((f) => f.type.startsWith('image/'))
      if (!images.length) return setError('Ces fichiers ne sont pas des images. Utilisez des PNG, JPG ou WebP.')
      if (src) reset()
      setError('')
      const added = images.map((file) => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) })) // url: thumbnail and crop source
      return setBatch((b) => [...(b ?? []), ...added])
    }
    open(files[0], forMode)
  }
  const openRef = useRef(openFiles)
  openRef.current = openFiles

  async function open(file, forMode = mode) {
    setError('')
    if (forMode === 'video') {
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

  async function applyCrop(rect, preset) {
    setCropping(false)
    const crop = isFull(rect) && !preset?.ratio ? null : rect
    const url = crop ? await cropPreview(src.img, crop) : src.fullUrl
    if (src.url !== src.fullUrl) URL.revokeObjectURL(src.url)
    const r = region(src.img, crop)
    setSrc({ ...src, crop, url, cropPreset: preset?.id })
    setSize(preset?.size ? { w: preset.size[0], h: preset.size[1] } : { w: r.w, h: r.h })
    setRaster(null)
  }

  const resetRef = useRef(null)
  const loaded = mode === 'video' ? video : (batch ?? src)
  busyWithFile.current = !!loaded
  resetRef.current = loaded ? reset : null
  function reset() {
    if (video) URL.revokeObjectURL(video.url), setVideo(null)
    batch?.forEach((it) => URL.revokeObjectURL(it.url))
    setBatch(null)
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
    const onPaste = (e) => e.clipboardData?.files.length && openRef.current(e.clipboardData.files)
    addEventListener('paste', onPaste)
    return () => removeEventListener('paste', onPaste)
  }, [])

  // "Ouvrir avec unpixel" and "Partager vers unpixel" (installed app): videos go to the video tool, images to the image tool.
  useEffect(() => {
    const route = (files) => {
      const videos = files.filter(isVideoFile)
      openRef.current(videos.length ? videos : files, videos.length ? 'video' : 'image')
    }
    window.launchQueue?.setConsumer(async ({ files }) => files?.length && route(await Promise.all(files.map((h) => h.getFile()))))
    // The service worker kept the shared files in a cache and opened ?shared
    if (!new URLSearchParams(location.search).has('shared')) return
    history.replaceState(null, '', location.pathname + location.hash)
    ;(async () => {
      const inbox = await caches.open(SHARE_INBOX)
      const files = await Promise.all(
        (await inbox.keys()).map(async (req) => {
          const res = await inbox.match(req)
          return new File([await res.blob()], decodeURIComponent(res.headers.get('x-name') ?? 'fichier'), { type: res.headers.get('content-type') ?? '' })
        }),
      )
      await caches.delete(SHARE_INBOX)
      if (files.length) route(files)
    })().catch(() => setError('Les fichiers partagés n’ont pas pu être ouverts. Ouvrez-les depuis unpixel.'))
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
        const done = await exportImage(src.img, region(src.img, src.crop), size.w, size.h, out, () => cancelled)
        if (!done || cancelled) return
        const { blob, q } = done
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
    onDrop: (e) => (e.preventDefault(), setDragging(false), openFiles(e.dataTransfer.files)),
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
            {mode === 'video' ? 'Changer de vidéo' : batch ? 'Ajouter des images' : 'Changer d’image'}
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
        multiple={mode === 'image'}
        hidden
        onChange={(e) => (openFiles(e.target.files), (e.target.value = ''))}
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
                    : mode === 'image'
                      ? 'Une seule ou toutes d’un coup, regroupées dans un ZIP. Ou cliquez pour choisir.'
                      : 'ou cliquez pour choisir un fichier. Vous pouvez aussi coller une image avec Ctrl+V.'}
                </span>
              </DropZone>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </section>
            {!installedApp && <HomeSections mode={mode} onPick={pickTool} />}
          </motion.main>
        ) : batch ? (
          <Batch key="batch" items={batch} onRemove={(id) => (URL.revokeObjectURL(batch.find((it) => it.id === id).url), setBatch((b) => (b.length > 1 ? b.filter((it) => it.id !== id) : null)))} />
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
                initialPreset={src.cropPreset}
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

      {!installedApp && <Footer onInstall={installPrompt ? install : null} onPickTool={pickTool} />}
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
