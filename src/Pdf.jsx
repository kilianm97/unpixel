import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Segmented } from './ui.jsx'
import { fmt } from './imageExport.js'
import { PDF_LEVELS, compressPdf, recompressInBrowser } from './pdfCompress.js'

const spring = { type: 'spring', stiffness: 260, damping: 30 }

// shortcut: runs on the main thread, a PDF with hundreds of large images can freeze the page for a while; move compressPdf to a worker if that happens.
export default function PdfTool({ pdf }) {
  const [levelId, setLevelId] = useState('standard')
  const [res, setRes] = useState(null) // { url, size, images, changed }
  const [error, setError] = useState('')
  const level = PDF_LEVELS.find((l) => l.id === levelId)

  useEffect(() => {
    let cancelled = false
    let url
    setRes(null)
    setError('')
    ;(async () => {
      try {
        const input = new Uint8Array(await pdf.file.arrayBuffer())
        const r = await compressPdf(input, level, recompressInBrowser, () => cancelled)
        if (!r || cancelled) return
        url = URL.createObjectURL(new Blob([r.bytes], { type: 'application/pdf' }))
        setRes({ url, size: r.bytes.length, images: r.images, changed: r.changed })
      } catch (e) {
        if (!cancelled) setError(e.message)
      }
    })()
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [pdf, levelId])

  const busy = !res && !error
  const gain = res && Math.round((1 - res.size / pdf.file.size) * 100)
  const lighter = gain > 0
  const stem = pdf.name.replace(/\.pdf$/i, '') || 'document'

  return (
    <motion.main key="pdf" className="work" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
      <section className="stage pdf-stage" aria-busy={busy}>
        <iframe src={lighter ? res.url : pdf.url} title={lighter ? 'Aperçu du PDF compressé' : 'Aperçu du PDF'} />
        {busy && (
          <span className="status" role="status">
            <span className="spinner" aria-hidden="true" /> Compression…
          </span>
        )}
      </section>

      <aside className="panel">
        <div>
          <h2 className="file" title={pdf.name}>
            {pdf.name}
          </h2>
          <div className="gain" aria-live="polite">
            {busy ? (
              <span className="gain-wait">Calcul en cours…</span>
            ) : res && lighter ? (
              <>
                <strong>−{gain} %</strong>
                <span>
                  {fmt(pdf.file.size)} → {fmt(res.size)}
                </span>
              </>
            ) : (
              res && <span>{fmt(pdf.file.size)}, aucun gain possible</span>
            )}
          </div>
          {/* Always there, two lines tall: the level selector below never moves while the result comes in */}
          <p className="hint gain-why pdf-why">
            {!res
              ? busy && 'Recherche des images à alléger…'
              : res.images === 0
                ? 'Pas d’image dans ce PDF : il n’y a presque rien à gagner.'
                : res.changed
                  ? `${res.changed} image${res.changed > 1 ? 's' : ''} allégée${res.changed > 1 ? 's' : ''} sur ${res.images}. Le texte reste net.`
                  : 'Images déjà légères, ou dans un format gardé tel quel.'}
          </p>
        </div>

        <div className="field">
          <span className="field-label">Niveau</span>
          <Segmented label="Niveau de compression du PDF" value={levelId} onChange={setLevelId} options={PDF_LEVELS.map((l) => [l.id, l.label])} />
          <span className="hint">{level.desc}.</span>
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="actions">
          <motion.a
            className="primary"
            href={lighter ? res.url : undefined}
            download={`${stem}-compresse.pdf`}
            aria-disabled={!lighter}
            onClick={(e) => lighter || e.preventDefault()}
            whileTap={{ scale: 0.97 }}
          >
            Télécharger le PDF
          </motion.a>
        </div>
      </aside>
    </motion.main>
  )
}
