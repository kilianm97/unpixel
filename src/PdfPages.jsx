import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { PageThumb, loadPreview, downloadPdf } from './PdfThumb.jsx'
import { rotatePages, removePages, pdfStem } from './pdfTools.js'

const spring = { type: 'spring', stiffness: 260, damping: 30 }

// Rotate pages or take pages out: the same grid of pages, two ways of clicking it.
export default function PdfPages({ pdf, action }) {
  const rotate = action === 'rotate'
  const [doc, setDoc] = useState(null)
  const [error, setError] = useState('')
  const [turns, setTurns] = useState({}) // page index → quarter turns clockwise
  const [removed, setRemoved] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')

  useEffect(() => {
    let alive = true
    let loaded
    loadPreview(pdf.file)
      .then((d) => (alive ? setDoc((loaded = d)) : d.loadingTask.destroy()))
      .catch((e) => alive && setError(e.message))
    return () => {
      alive = false
      loaded?.loadingTask.destroy() // pdf.js 6: the loading task owns the worker
    }
  }, [pdf])

  const count = doc?.numPages ?? 0
  const pages = Array.from({ length: count }, (_, i) => i)
  const turn = (i, d) => (setDone(''), setTurns((t) => ({ ...t, [i]: (t[i] ?? 0) + d })))
  const turnAll = (d) => (setDone(''), setTurns((t) => Object.fromEntries(pages.map((i) => [i, (t[i] ?? 0) + d]))))
  const toggle = (i) => (
    setDone(''),
    setRemoved((s) => {
      const next = new Set(s)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  )
  const changed = rotate ? pages.some((i) => (turns[i] ?? 0) % 4) : removed.size > 0
  const allGone = !rotate && count > 0 && removed.size >= count

  async function save() {
    setBusy(true)
    setError('')
    try {
      const bytes = new Uint8Array(await pdf.file.arrayBuffer())
      const out = rotate ? await rotatePages(bytes, pages.map((i) => turns[i] ?? 0)) : await removePages(bytes, [...removed])
      downloadPdf(out, `${pdfStem(pdf.name)}${rotate ? '-pivote' : '-pages'}.pdf`)
      setDone(rotate ? 'PDF pivoté téléchargé.' : `PDF de ${count - removed.size} page${count - removed.size > 1 ? 's' : ''} téléchargé.`)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.main key={action} className="work" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
      <section className="pages" aria-label="Pages du PDF" aria-busy={!doc && !error}>
        {!doc && !error && <p className="hint">Lecture des pages…</p>}
        <ol className="pages-grid">
          {doc &&
            pages.map((i) => {
              const angle = (turns[i] ?? 0) * 90
              const thumb = (
                <span className="page-box">
                  <motion.span className="page-sheet" animate={{ rotate: angle }} transition={spring}>
                    <PageThumb doc={doc} n={i + 1} />
                  </motion.span>
                  {!rotate && removed.has(i) && (
                    <span className="page-removed" aria-hidden="true">
                      Retirée
                    </span>
                  )}
                </span>
              )
              return (
                <li key={i} className="page-card" data-removed={!rotate && removed.has(i)}>
                  {rotate ? (
                    <>
                      {thumb}
                      <span className="page-tools">
                        <button type="button" onClick={() => turn(i, -1)} aria-label={`Pivoter la page ${i + 1} vers la gauche`}>
                          <TurnIcon flip />
                        </button>
                        <span className="page-num">{i + 1}</span>
                        <button type="button" onClick={() => turn(i, 1)} aria-label={`Pivoter la page ${i + 1} vers la droite`}>
                          <TurnIcon />
                        </button>
                      </span>
                    </>
                  ) : (
                    <button type="button" className="page-toggle" aria-pressed={removed.has(i)} onClick={() => toggle(i)} aria-label={`Page ${i + 1}`}>
                      {thumb}
                      <span className="page-num">{i + 1}</span>
                    </button>
                  )}
                </li>
              )
            })}
        </ol>
      </section>

      <aside className="panel">
        <div>
          <h2 className="file" title={pdf.name}>
            {pdf.name}
          </h2>
          <p className="hint gain-why">
            {count ? `${count} page${count > 1 ? 's' : ''}` : ' '}
            {!rotate && removed.size > 0 && `, ${removed.size} retirée${removed.size > 1 ? 's' : ''}`}
          </p>
        </div>

        <p className="hint">
          {rotate
            ? 'Utilisez les flèches sous chaque page, ou pivotez toutes les pages d’un coup.'
            : 'Cliquez sur les pages à retirer. Cliquez à nouveau pour garder une page.'}
        </p>

        {rotate ? (
          <div className="field">
            <span className="field-label">Toutes les pages</span>
            <div className="pages-actions">
              <button className="ghost" onClick={() => turnAll(-1)} disabled={!count}>
                <TurnIcon flip /> Vers la gauche
              </button>
              <button className="ghost" onClick={() => turnAll(1)} disabled={!count}>
                <TurnIcon /> Vers la droite
              </button>
            </div>
          </div>
        ) : null}

        {changed && (
          <button className="link pages-reset" onClick={() => (rotate ? setTurns({}) : setRemoved(new Set()), setDone(''))}>
            {rotate ? 'Annuler les rotations' : 'Garder toutes les pages'}
          </button>
        )}
        {allGone && <p className="error">Gardez au moins une page.</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="actions">
          <motion.button className="primary" onClick={save} disabled={!changed || allGone || busy || !!error} whileTap={{ scale: 0.97 }}>
            {busy ? 'Préparation…' : 'Télécharger le PDF'}
          </motion.button>
          <p className="hint" role="status">
            {done || (!changed && count ? (rotate ? 'Pivotez au moins une page pour télécharger.' : 'Choisissez au moins une page à retirer.') : '')}
          </p>
        </div>
      </aside>
    </motion.main>
  )
}

function TurnIcon({ flip }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" className="turn-icon" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M19 12a7 7 0 1 1-2.05-4.95M19 4v4h-4" />
    </svg>
  )
}
