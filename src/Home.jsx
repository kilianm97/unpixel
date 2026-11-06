import { useEffect, useId, useRef, useState } from 'react'
import { motion, AnimatePresence, useInView, useMotionValue, useMotionValueEvent, useTransform, animate } from 'motion/react'
import { findQuality, pixelsOf } from './compress.js'
import { at } from './base.js'

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const ease = [0.65, 0, 0.35, 1]
const out = [0.16, 1, 0.3, 1]
const spring = { type: 'spring', stiffness: 300, damping: 30 }
const reveal = (delay = 0) => ({
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.3 },
  transition: { duration: 0.7, ease: out, delay },
})
const fmt = (b) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} Ko` : `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`)

// Every claim below matches what the tools really do.
const FEATURES = {
  image: {
    tab: 'Images',
    try: 'Essayer l’outil Images',
    title: 'Allégez vos images, sans perte visible.',
    lead: 'unpixel essaie plusieurs réglages et garde le plus léger qui reste identique à l’œil. La démo ci-contre est calculée en direct, dans votre navigateur.',
    points: [
      ['Compression optimale', 'le réglage le plus léger sans différence visible, choisi pour vous.'],
      ['Rognez et redimensionnez', 'au pixel près, proportions gardées.'],
      ['JPG, WebP ou PNG', 'selon votre usage, web ou impression.'],
    ],
  },
  svg: {
    tab: 'Logo en SVG',
    try: 'Essayer Logo en SVG',
    title: 'Glissez pour unpixeliser.',
    lead: 'Un PNG devient flou quand on l’agrandit. unpixel redessine votre logo en courbes vectorielles : il reste net de la carte de visite à la bâche de 3 mètres.',
    points: [
      ['Couleurs exactes', 'les teintes de votre marque, sans dégradés parasites.'],
      ['Fond transparent', 'intérieur des lettres compris.'],
      ['Fichier compact', 'quelques Ko en général, prêt pour vos outils de design.'],
    ],
    tip: 'Pour un tracé net, partez d’un logo d’au moins 300 pixels de large.',
  },
  video: {
    tab: 'Vidéo',
    try: 'Essayer l’outil Vidéo',
    title: 'Coupez et compressez vos vidéos.',
    lead: 'Gardez seulement le passage utile, choisissez la qualité, et partagez un MP4 lisible partout.',
    points: [
      ['Coupe précise', 'au dixième de seconde, à la souris ou au clavier.'],
      ['Trois préréglages', 'du fichier le plus léger à la qualité maximale.'],
      ['MP4 H.264 + AAC', 'lisible sur tous les appareils et réseaux sociaux.'],
    ],
  },
}

const FAQ = [
  ['Est-ce vraiment gratuit ?', 'Oui. Pas de compte, pas d’abonnement, pas de filigrane sur vos fichiers.'],
  [
    'Mes fichiers sont-ils envoyés quelque part ?',
    'Non. Images, logos et vidéos sont traités dans votre navigateur, sur votre ordinateur. Ils ne passent jamais par un serveur.',
  ],
  [
    'Est-ce que la qualité baisse ?',
    'En compression optimale, unpixel compare le résultat pixel par pixel avec l’original et garde le réglage le plus léger sans différence visible.',
  ],
  [
    'Quels formats sont acceptés ?',
    'Images : PNG, JPG, WebP, GIF, BMP et SVG. Vidéos : MP4, MOV, MKV et WebM. Vous exportez en PNG, JPG, WebP, SVG ou MP4.',
  ],
  [
    'Est-ce que ça marche sans internet ?',
    'Oui, une fois l’app installée avec le bouton « Installer l’app ». Elle s’ouvre dans sa propre fenêtre et fonctionne hors connexion.',
  ],
  [
    'Quels navigateurs sont pris en charge ?',
    'unpixel est conçu et testé pour Chrome et Edge à jour, qui gèrent les trois outils, vidéo comprise.',
  ],
]

export function HomeSections({ mode, onPick }) {
  return (
    <>
      <Features mode={mode} onPick={onPick} />
      <Faq />
    </>
  )
}

/* ---------- Three tools, one section ---------- */

function Features({ mode, onPick }) {
  const [tab, setTab] = useState(mode)
  useEffect(() => setTab(mode), [mode])
  const f = FEATURES[tab]

  return (
    <section className="features" aria-labelledby="features-title">
      <motion.h2 id="features-title" {...reveal()}>
        Trois outils, un seul endroit.
      </motion.h2>
      <motion.div className="seg features-tabs" role="tablist" aria-label="Fonctionnalités" {...reveal(0.08)}>
        {Object.entries(FEATURES).map(([id, x]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className="seg-opt" onClick={() => setTab(id)}>
            {tab === id && <motion.span layoutId="feature-pill" className="seg-pill" transition={spring} />}
            <span className="seg-text">{x.tab}</span>
          </button>
        ))}
      </motion.div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          className="feature"
          role="tabpanel"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.35, ease: out }}
        >
          <div className="feature-copy">
            <h3>{f.title}</h3>
            <p className="feature-lead">{f.lead}</p>
            <ul className="feature-points">
              {f.points.map(([title, text], i) => (
                <li key={title}>
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <motion.path
                      d="M5 12.5l4.5 4.5L19 7.5"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.5, ease, delay: 0.2 + 0.1 * i }}
                    />
                  </svg>
                  <span>
                    <strong>{title}</strong> : {text}
                  </span>
                </li>
              ))}
            </ul>
            {f.tip && <p className="feature-tip">{f.tip}</p>}
            {tab !== mode && (
              <button className="link feature-try" onClick={() => onPick(tab)}>
                {f.try}
              </button>
            )}
          </div>
          {tab === 'image' ? <ImageDemo /> : tab === 'svg' ? <LogoDemo /> : <VideoDemo />}
        </motion.div>
      </AnimatePresence>
    </section>
  )
}

/* A before/after stage with a draggable divider that sweeps once when it appears */
function Before({ before, after, labels, aria, pixelated }) {
  const stage = useRef(null)
  const range = useRef(null)
  const inView = useInView(stage, { once: true, amount: 0.6 })
  const pos = useMotionValue(100)
  const clipBefore = useTransform(pos, (p) => `inset(0 ${100 - p}% 0 0)`)
  const clipAfter = useTransform(pos, (p) => `inset(0 0 0 ${p}%)`)
  const left = useTransform(pos, (p) => `${p}%`)
  useMotionValueEvent(pos, 'change', (v) => range.current && (range.current.value = v))
  useEffect(() => {
    if (!inView || !after) return
    if (reduced()) return pos.set(50)
    ;(async () => {
      await animate(pos, 12, { duration: 1.1, ease })
      await animate(pos, 50, { duration: 1, ease })
    })()
  }, [inView, !!after])
  const drag = (e) => {
    if (e.buttons !== 1 && e.type !== 'pointerdown') return
    const b = stage.current.getBoundingClientRect()
    pos.set(Math.min(100, Math.max(0, ((e.clientX - b.left) / b.width) * 100)))
  }
  return (
    <div
      ref={stage}
      className="demo-stage"
      onPointerDown={(e) => (e.currentTarget.setPointerCapture(e.pointerId), drag(e))}
      onPointerMove={drag}
    >
      {before && (
        <motion.img
          src={before}
          className={`demo-art${pixelated ? ' pixelated' : ''}`}
          style={{ clipPath: clipBefore }}
          alt=""
          draggable="false"
        />
      )}
      {after && <motion.img src={after} className="demo-art" style={{ clipPath: clipAfter }} alt="" draggable="false" />}
      <motion.div className="divider" style={{ left }} aria-hidden="true">
        <span className="knob">
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path d="M9 6l-5 6 5 6M15 6l5 6-5 6" />
          </svg>
        </span>
      </motion.div>
      <input
        ref={range}
        className="scrub"
        type="range"
        min="0"
        max="100"
        step="0.1"
        defaultValue="100"
        aria-label={aria}
        onChange={(e) => pos.set(+e.target.value)}
      />
      <span className="tag tag-l">{labels[0]}</span>
      <span className="tag tag-r">{labels[1]}</span>
    </div>
  )
}

/* Logo: our own symbol as a tiny PNG shown large, next to the real SVG */
function LogoDemo() {
  const [pixels, setPixels] = useState(null)
  useEffect(() => {
    const img = new Image()
    img.src = at('favicon.svg')
    img.decode().then(() => {
      const c = document.createElement('canvas')
      c.width = c.height = 20
      c.getContext('2d').drawImage(img, 0, 0, 20, 20)
      setPixels(c.toDataURL())
    })
  }, [])
  return (
    <div className="demo">
      <Before before={pixels} after={at('favicon.svg')} labels={['PNG agrandi', 'SVG']} aria="Comparer un PNG agrandi et un SVG" pixelated />
    </div>
  )
}

/* Images: a real photo (CC0, Wikimedia Commons) compressed in the visitor's browser with the tool's optimal mode */
const PHOTO = {
  src: at('demo/studio.jpg'),
  credit: 'Photo : Wikimedia Commons, domaine public (CC0)',
  href: 'https://commons.wikimedia.org/wiki/File:Photo-studio.jpg',
}

function ImageDemo() {
  const [res, setRes] = useState(null)
  const holder = useRef(null)
  const inView = useInView(holder, { once: true, amount: 0.2 })
  useEffect(() => {
    if (!inView) return
    let alive = true
    let url
    ;(async () => {
      const original = await (await fetch(PHOTO.src)).blob()
      const bmp = await createImageBitmap(original)
      const c = document.createElement('canvas')
      c.width = bmp.width
      c.height = bmp.height
      c.getContext('2d').drawImage(bmp, 0, 0)
      bmp.close()
      const ref = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      const encode = (q) => new Promise((ok) => c.toBlob(ok, 'image/webp', q / 100))
      const found = await findQuality(encode, (b) => pixelsOf(b, c.width, c.height), ref, { cancelled: () => !alive })
      if (!alive || !found || found.blob.type !== 'image/webp') return
      url = URL.createObjectURL(found.blob)
      setRes({ after: url, from: original.size, to: found.blob.size, q: found.q })
    })()
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [inView])

  const gain = res && Math.round((1 - res.to / res.from) * 100)
  return (
    <div ref={holder} className="demo">
      <Before
        before={PHOTO.src}
        after={res?.after}
        labels={[res ? `JPG ${fmt(res.from)}` : 'JPG', res ? `WebP ${fmt(res.to)}` : 'WebP']}
        aria="Comparer la photo d’origine et la version compressée"
      />
      <p className="demo-caption" aria-live="polite">
        {!res ? (
          'Compression en cours sur votre ordinateur…'
        ) : gain > 0 ? (
          <>
            <strong>−{gain} %</strong> en WebP qualité {res.q}, sans différence visible. Mesuré à l’instant sur votre ordinateur.
          </>
        ) : (
          'Cette photo est déjà très compressée : unpixel le détecte et vous le dit.'
        )}
      </p>
      <p className="demo-credit">
        <a href={PHOTO.href} target="_blank" rel="noopener">
          {PHOTO.credit}
        </a>
      </p>
    </div>
  )
}

/* Video: a real clip (Pexels license) cut to 8 s and compressed with the Léger preset.
   The strip shows real frames; the screen shows the frame under the handle being moved. */
const CLIP = {
  src: at('demo/paint.mp4'),
  credit: 'Vidéo : StefWithAnF sur Pexels',
  href: 'https://www.pexels.com/video/colorful-paint-moving-and-mixing-in-slow-motion-10776846/',
}
const FRAMES = 30 // preview resolution of the timeline (every 3rd one is shown in the strip)
const GAP = 0.1 // smallest selection, as a fraction of the clip

// Frames grabbed once by seeking a hidden <video>: no extra library on the homepage
async function grabFrames(src, count, alive) {
  const v = document.createElement('video')
  v.muted = true
  v.preload = 'auto'
  v.src = src
  await new Promise((ok, fail) => ((v.onloadeddata = ok), (v.onerror = fail)))
  const out = []
  for (let i = 0; i < count && alive(); i++) {
    v.currentTime = ((i + 0.5) / count) * v.duration
    await new Promise((ok) => (v.onseeked = ok))
    const c = document.createElement('canvas')
    c.width = 480
    c.height = 270
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height)
    out.push(c)
  }
  const duration = v.duration // read before the element is emptied below
  v.removeAttribute('src')
  v.load()
  return { frames: out, duration }
}

const tenths = (s) => s.toFixed(1).replace('.', ',')

function VideoDemo() {
  const [clip, setClip] = useState(null)
  const [trim, setTrim] = useState({ start: 0, end: 1 })
  const [edge, setEdge] = useState('start')
  const touched = useRef(false)
  const strip = useRef(null)
  const screen = useRef(null)
  const drag = useRef(null)

  useEffect(() => {
    let alive = true
    grabFrames(CLIP.src, FRAMES, () => alive).then((r) => alive && setClip(r))
    return () => {
      alive = false
    }
  }, [])

  // Until the visitor takes over, the handles show the idea on their own
  useEffect(() => {
    if (!clip) return
    if (reduced()) return setTrim({ start: 0.18, end: 0.74 })
    let raf
    const t0 = performance.now()
    const tick = (now) => {
      if (touched.current) return
      const p = ((now - t0) / 6000) % 1
      const k = (a, b) => Math.min(1, Math.max(0, (p - a) / (b - a)))
      const smooth = (x) => x * x * (3 - 2 * x)
      const back = smooth(k(0.82, 1))
      const start = 0.18 * smooth(k(0, 0.3)) * (1 - back)
      const end = 1 - 0.26 * smooth(k(0.38, 0.68)) * (1 - back)
      setEdge(p < 0.34 ? 'start' : p < 0.82 ? 'end' : 'start')
      setTrim({ start, end })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [clip])

  // The screen shows the frame at the handle that moves
  const at = edge === 'start' ? trim.start : trim.end
  const index = clip ? Math.min(FRAMES - 1, Math.max(0, Math.round(at * FRAMES - 0.5))) : 0
  useEffect(() => {
    const c = screen.current
    const f = clip?.frames[index]
    if (c && f) c.getContext('2d').drawImage(f, 0, 0, c.width, c.height)
  }, [clip, index])

  const take = () => (touched.current = true)
  const pos = (e) => {
    const b = strip.current.getBoundingClientRect()
    return Math.min(1, Math.max(0, (e.clientX - b.left) / b.width))
  }
  // x: a position (0..1) or a function of the current one, so repeated key presses add up
  const move = (which, x) =>
    setTrim((t) => {
      const v = typeof x === 'function' ? x(t[which]) : x
      return which === 'start' ? { ...t, start: Math.min(Math.max(0, v), t.end - GAP) } : { ...t, end: Math.max(Math.min(1, v), t.start + GAP) }
    })
  const down = (which) => (e) => {
    e.preventDefault()
    take()
    strip.current.setPointerCapture(e.pointerId)
    drag.current = which
    setEdge(which)
  }
  const key = (which) => (e) => {
    const d = { ArrowLeft: -0.02, ArrowRight: 0.02 }[e.key]
    if (!d) return
    e.preventDefault()
    take()
    setEdge(which)
    move(which, (v) => v + d * (e.shiftKey ? 5 : 1))
  }

  const secs = (f) => (clip ? f * clip.duration : 0)
  return (
    <div className="demo">
      <div className="demo-stage video-demo">
        <canvas
          ref={screen}
          className="video-screen"
          width="960"
          height="540"
          role="img"
          aria-label={`Image de la vidéo à ${tenths(secs(at))} s`}
        />
        <div
          ref={strip}
          className="video-strip"
          onPointerMove={(e) => drag.current && move(drag.current, pos(e))}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        >
          {Array.from({ length: 10 }, (_, i) => {
            const f = clip?.frames[i * 3 + 1]
            return f ? (
              <canvas key={i} width="96" height="54" ref={(el) => el?.getContext('2d').drawImage(f, 0, 0, 96, 54)} aria-hidden="true" />
            ) : (
              <span key={i} className="video-wait" aria-hidden="true" />
            )
          })}
          <span className="video-shade" style={{ left: 0, width: `${trim.start * 100}%` }} aria-hidden="true" />
          <span className="video-shade" style={{ right: 0, width: `${(1 - trim.end) * 100}%` }} aria-hidden="true" />
          <span
            className="video-sel"
            style={{ left: `${trim.start * 100}%`, width: `${(trim.end - trim.start) * 100}%` }}
            aria-hidden="true"
          />
          {['start', 'end'].map((which) => (
            <span
              key={which}
              className={`video-handle ${which}`}
              style={{ left: `${trim[which] * 100}%` }}
              role="slider"
              tabIndex={0}
              aria-label={which === 'start' ? 'Début de la coupe' : 'Fin de la coupe'}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(trim[which] * 100)}
              aria-valuetext={`${tenths(secs(trim[which]))} s`}
              onPointerDown={down(which)}
              onKeyDown={key(which)}
            />
          ))}
        </div>
        <p className="video-time" aria-live="off">
          {clip ? (
            <>
              <strong>
                {tenths(secs(trim.start))} s → {tenths(secs(trim.end))} s
              </strong>
              , {tenths(secs(trim.end - trim.start))} s gardées
            </>
          ) : (
            'Chargement des images…'
          )}
        </p>
      </div>
      <p className="demo-credit">
        <a href={CLIP.href} target="_blank" rel="noopener">
          {CLIP.credit}
        </a>
        , coupée à 8 s et compressée avec le préréglage Léger d’unpixel. Faites glisser les poignées.
      </p>
    </div>
  )
}

/* ---------- FAQ ---------- */

function Faq() {
  return (
    <section className="faq" aria-labelledby="faq-title">
      <motion.h2 id="faq-title" {...reveal()}>
        Questions fréquentes
      </motion.h2>
      {FAQ.map(([q, a], i) => (
        <FaqItem key={q} q={q} a={a} delay={0.05 * i} />
      ))}
    </section>
  )
}

function FaqItem({ q, a, delay }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <motion.div className="faq-item" {...reveal(delay)}>
      <h3>
        <button aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
          {q}
          <motion.span className="faq-plus" aria-hidden="true" animate={{ rotate: open ? 45 : 0 }} transition={{ duration: 0.3, ease }}>
            +
          </motion.span>
        </button>
      </h3>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={id}
            className="faq-answer"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.4, ease }}
          >
            <p>{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export function InstallIcon() {
  return (
    <svg className="install-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path className="install-arrow" d="M12 4v11M7 10l5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  )
}
