import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { zipSync } from 'fflate'
import { FORMATS, fmt, exportImage, decode, batchSize, uniqueNames } from './imageExport.js'
import { Segmented, Slider } from './ui.jsx'
import { Cropper } from './Cropper.jsx'
import { CROP_PRESETS, cropPixels, isFull, FULL } from './crop.js'

const spring = { type: 'spring', stiffness: 260, damping: 30 }
// crop: { rect (fractions), preset } chosen for this image only. A preset with a fixed size (1200 × 630) keeps it.
async function convert(file, out, crop, cancelled) {
  const d = await decode(file)
  try {
    const { naturalWidth: W, naturalHeight: H } = d.img
    const r = crop ? cropPixels(crop.rect, W, H) : { x: 0, y: 0, w: W, h: H }
    const fixed = CROP_PRESETS.find((p) => p.id === crop?.preset)?.size
    const { w, h } = fixed ? { w: fixed[0], h: fixed[1] } : batchSize(r.w, r.h)
    const done = await exportImage(d.img, r, w, h, out, cancelled)
    return done && { ...done, name: `${d.name}.${FORMATS[out.format].ext}`, w, h }
  } finally {
    URL.revokeObjectURL(d.url)
  }
}

export function Batch({ items, onRemove }) {
  const [out, setOut] = useState({
    format: 'webp',
    compression: 'optimal',
    quality: 80,
  })
  const [results, setResults] = useState({}) // id → { key, status, blob, url, name, error }
  const [zipping, setZipping] = useState(false)
  const [crops, setCrops] = useState({}) // id → { rect, preset }
  const [editing, setEditing] = useState(null) // { id, url, natural } while one image is being cropped
  const settings = JSON.stringify(out)
  const keyOf = (id) => settings + JSON.stringify(crops[id] ?? null) // a result is only valid for the settings that made it
  const current = (id) => (results[id]?.key === keyOf(id) ? results[id] : null)
  const latest = useRef(results)
  latest.current = results

  const put = (id, r) =>
    setResults((m) => {
      if (m[id]?.url && m[id].url !== r.url) URL.revokeObjectURL(m[id].url)
      return { ...m, [id]: r }
    })

  // One image at a time, in order: a settings change restarts the queue after a short pause (sliders)
  useEffect(() => {
    let cancelled = false
    const t = setTimeout(async () => {
      for (const it of items) {
        if (cancelled) return
        const key = keyOf(it.id)
        const prev = latest.current[it.id]
        if (prev?.key === key && prev.status !== 'working') continue // "working" means an interrupted run: redo it
        put(it.id, { key, status: 'working' })
        try {
          const done = await convert(it.file, out, crops[it.id], () => cancelled)
          if (cancelled || !done) return
          put(it.id, {
            key,
            status: 'done',
            ...done,
            url: URL.createObjectURL(done.blob),
          })
        } catch (e) {
          if (cancelled) return
          put(it.id, { key, status: 'error', error: e.message })
        }
      }
    }, 250)
    return () => ((cancelled = true), clearTimeout(t))
  }, [items, settings, crops])

  useEffect(
    () => () => {
      Object.values(latest.current).forEach((r) => r.url && URL.revokeObjectURL(r.url))
    },
    [],
  )

  function remove(id) {
    const r = latest.current[id]
    if (r?.url) URL.revokeObjectURL(r.url)
    setResults(({ [id]: _, ...m }) => m)
    setCrops(({ [id]: _, ...m }) => m)
    onRemove(id)
  }

  async function editCrop(it) {
    const img = new Image()
    img.src = it.url
    try {
      await img.decode()
    } catch {
      return put(it.id, {
        key: keyOf(it.id),
        status: 'error',
        error: 'Impossible de lire cette image.',
      })
    }
    setEditing({
      id: it.id,
      url: img.src,
      natural: { w: img.naturalWidth, h: img.naturalHeight },
    })
  }
  function applyCrop(rect, preset) {
    const id = editing.id
    setEditing(null)
    setCrops(({ [id]: _, ...m }) => (isFull(rect) && !preset?.ratio ? m : { ...m, [id]: { rect, preset: preset?.id } }))
  }

  const ready = items.map((it) => current(it.id)).filter((r) => r?.status === 'done')
  const pending = items.filter((it) => !current(it.id) || current(it.id).status === 'working').length
  const before = items.reduce((s, it) => (current(it.id)?.status === 'done' ? s + it.file.size : s), 0)
  const after = ready.reduce((s, r) => s + r.blob.size, 0)
  const gain = before ? Math.round((1 - after / before) * 100) : null
  const f = FORMATS[out.format]

  async function downloadZip() {
    setZipping(true)
    try {
      const names = uniqueNames(ready.map((r) => r.name))
      const entries = {}
      await Promise.all(ready.map(async (r, i) => (entries[names[i]] = new Uint8Array(await r.blob.arrayBuffer()))))
      const zip = zipSync(entries, { level: 0 }) // images are already compressed: storing is instant and loses nothing
      const url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }))
      const a = Object.assign(document.createElement('a'), {
        href: url,
        download: 'unpixel-images.zip',
      })
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } finally {
      setZipping(false)
    }
  }

  return (
    <motion.main key="batch" className="work" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
      {editing ? (
        <Cropper
          key={editing.id}
          url={editing.url}
          initial={crops[editing.id]?.rect ?? FULL}
          initialPreset={crops[editing.id]?.preset}
          natural={editing.natural}
          onApply={applyCrop}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <section className="batch" aria-label="Images à traiter">
          <ul className="batch-list">
            <AnimatePresence initial={false}>
              {items.map((it) => {
                const r = current(it.id)
                const c = crops[it.id]?.rect
                const g = r?.status === 'done' ? Math.round((1 - r.blob.size / it.file.size) * 100) : null
                return (
                  <motion.li
                    key={it.id}
                    className="batch-item"
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -16 }}
                  >
                    <img
                      src={it.url}
                      alt=""
                      width="48"
                      height="48"
                      loading="lazy"
                      style={
                        c && {
                          objectViewBox: `inset(${c.y * 100}% ${(1 - c.x - c.w) * 100}% ${(1 - c.y - c.h) * 100}% ${c.x * 100}%)`,
                        }
                      }
                    />
                    <div className="batch-info">
                      <span className="batch-name" title={it.file.name}>
                        {it.file.name}
                      </span>
                      <span className="batch-status" data-state={r?.status ?? 'waiting'}>
                        {!r && 'En attente'}
                        {r?.status === 'working' && 'Compression…'}
                        {r?.status === 'error' && r.error}
                        {r?.status === 'done' && (
                          <>
                            {fmt(it.file.size)} → {fmt(r.blob.size)}
                            <strong data-worse={g <= 0}>{g > 0 ? ` −${g} %` : ' plus lourd'}</strong>
                          </>
                        )}
                      </span>
                      <span className="batch-actions">
                        <button
                          className="link"
                          onClick={() => editCrop(it)}
                          aria-label={`${c ? 'Modifier le rognage de' : 'Rogner'} ${it.file.name}`}
                        >
                          {c ? 'Modifier le rognage' : 'Rogner'}
                        </button>
                        {r?.status === 'done' && (
                          <a className="link" href={r.url} download={r.name} aria-label={`Télécharger ${r.name}`}>
                            Télécharger
                          </a>
                        )}
                      </span>
                    </div>
                    <button className="batch-remove" onClick={() => remove(it.id)} aria-label={`Retirer ${it.file.name}`}>
                      ×
                    </button>
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ul>
        </section>
      )}

      <aside className="panel">
        <div>
          <h2 className="file">
            {items.length} image{items.length > 1 ? 's' : ''}
          </h2>
          <div className="gain" aria-live="polite">
            {gain === null ? (
              <span className="gain-wait">Calcul en cours…</span>
            ) : (
              <>
                <strong data-worse={gain <= 0}>{gain > 0 ? `−${gain} %` : fmt(after)}</strong>
                <span>
                  {gain > 0 ? `${fmt(before)} → ${fmt(after)}` : `au lieu de ${fmt(before)}`}
                  {pending > 0 && `, ${pending} en cours`}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="field">
          <span className="field-label">Format</span>
          <Segmented
            label="Format du lot"
            value={out.format}
            onChange={(format) => setOut((o) => ({ ...o, format }))}
            options={Object.entries(FORMATS).map(([k, v]) => [k, v.label])}
          />
        </div>
        {f.lossy ? (
          <div className="field">
            <span className="field-label">Compression</span>
            <Segmented
              label="Compression du lot"
              value={out.compression}
              onChange={(compression) => setOut((o) => ({ ...o, compression }))}
              options={[
                ['none', 'Aucune'],
                ['optimal', 'Optimale'],
                ['manual', 'Manuelle'],
              ]}
            />
            <span className="hint">
              {out.compression === 'none' && 'Qualité maximale, fichiers les plus lourds.'}
              {out.compression === 'optimal' && 'Pour chaque image, le réglage le plus léger sans différence visible.'}
              {out.compression === 'manual' && 'La même qualité pour toutes les images.'}
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
        {f.type === 'image/jpeg' && <span className="hint">Le JPG ne gère pas la transparence : les fonds deviennent blancs.</span>}

        <div className="actions">
          <motion.button className="primary" disabled={!ready.length || pending > 0 || zipping} onClick={downloadZip} whileTap={{ scale: 0.97 }}>
            {pending > 0 ? `Compression… ${items.length - pending}/${items.length}` : `Télécharger le ZIP (${ready.length})`}
          </motion.button>
        </div>
      </aside>
    </motion.main>
  )
}
