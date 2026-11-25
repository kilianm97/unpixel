import { useEffect, useState } from 'react'
import { motion, Reorder } from 'motion/react'
import { PageThumb, loadPreview, downloadPdf } from './PdfThumb.jsx'
import { mergePdfs, pdfStem } from './pdfTools.js'
import { fmt } from './imageExport.js'

const spring = { type: 'spring', stiffness: 260, damping: 30 }

// files: [{ id, file, name, url }], in merge order. onChange(list | null): reorder, remove (null: none left).
export default function PdfMerge({ files, onChange }) {
  const [pages, setPages] = useState({}) // id → page count
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const move = (i, d) => {
    const list = [...files]
    ;[list[i], list[i + d]] = [list[i + d], list[i]]
    setDone('')
    onChange(list)
  }
  const remove = (id) => (setDone(''), onChange(files.length > 1 ? files.filter((f) => f.id !== id) : null))
  const total = files.reduce((n, f) => n + (pages[f.id] ?? 0), 0)
  const known = files.every((f) => pages[f.id])

  async function save() {
    setBusy(true)
    setError('')
    try {
      const out = await mergePdfs(await Promise.all(files.map(async (f) => new Uint8Array(await f.file.arrayBuffer()))))
      downloadPdf(out, `${pdfStem(files[0].name)}-fusion.pdf`)
      setDone(`PDF de ${total} pages téléchargé.`)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.main key="merge" className="work" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
      <section className="batch" aria-label="PDF à fusionner">
        <Reorder.Group axis="y" values={files} onReorder={(list) => (setDone(''), onChange(list))} className="batch-list merge-list">
          {files.map((f, i) => (
            <Reorder.Item key={f.id} value={f} className="batch-item merge-item">
              <span className="merge-grip" aria-hidden="true">
                <svg viewBox="0 0 12 18" width="10" height="16">
                  {[3, 9, 15].flatMap((y) => [<circle key={`a${y}`} cx="3" cy={y} r="1.5" />, <circle key={`b${y}`} cx="9" cy={y} r="1.5" />])}
                </svg>
              </span>
              <MergeThumb item={f} onPages={(n) => setPages((p) => ({ ...p, [f.id]: n }))} onError={(m) => setPages((p) => ({ ...p, [f.id]: 0 })) || setError(`${f.name} : ${m}`)} />
              <span className="batch-info">
                <span className="batch-name" title={f.name}>
                  {i + 1}. {f.name}
                </span>
                <span className="batch-status">
                  {pages[f.id] ? `${pages[f.id]} page${pages[f.id] > 1 ? 's' : ''}, ` : ''}
                  {fmt(f.file.size)}
                </span>
              </span>
              <span className="merge-moves">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Monter ${f.name}`}>
                  ↑
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === files.length - 1} aria-label={`Descendre ${f.name}`}>
                  ↓
                </button>
              </span>
              <button className="batch-remove" onClick={() => remove(f.id)} aria-label={`Retirer ${f.name}`}>
                ×
              </button>
            </Reorder.Item>
          ))}
        </Reorder.Group>
      </section>

      <aside className="panel">
        <div>
          <h2 className="file">
            {files.length} PDF{known && total ? `, ${total} pages` : ''}
          </h2>
          <p className="hint gain-why">L’ordre de la liste est l’ordre des pages. Faites glisser un fichier, ou utilisez les flèches.</p>
        </div>
        {files.length < 2 && <p className="notice">Ajoutez au moins un autre PDF avec le bouton « Ajouter des PDF », ou déposez-le ici.</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <motion.button className="primary" onClick={save} disabled={files.length < 2 || busy} whileTap={{ scale: 0.97 }}>
            {busy ? 'Fusion…' : 'Fusionner et télécharger'}
          </motion.button>
          <p className="hint" role="status">
            {done}
          </p>
        </div>
      </aside>
    </motion.main>
  )
}

// First page of one file, and its page count
function MergeThumb({ item, onPages, onError }) {
  const [doc, setDoc] = useState(null)
  useEffect(() => {
    let alive = true
    let loaded
    loadPreview(item.file)
      .then((d) => (alive ? (setDoc((loaded = d)), onPages(d.numPages)) : d.loadingTask.destroy()))
      .catch((e) => alive && onError(e.message))
    return () => {
      alive = false
      loaded?.loadingTask.destroy() // pdf.js 6: the loading task owns the worker
    }
  }, [item])
  return <span className="merge-thumb">{doc && <PageThumb doc={doc} n={1} size={64} />}</span>
}
