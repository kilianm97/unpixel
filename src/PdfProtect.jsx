import { useState } from 'react'
import { motion } from 'motion/react'
import { downloadPdf } from './PdfThumb.jsx'
import { protectPdf, pdfStem } from './pdfTools.js'

const spring = { type: 'spring', stiffness: 260, damping: 30 }
const MIN = 6

export default function PdfProtect({ pdf }) {
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const short = password.length > 0 && password.length < MIN
  const mismatch = again.length > 0 && again !== password
  const ok = password.length >= MIN && again === password

  async function save(e) {
    e.preventDefault()
    if (!ok) return
    setBusy(true)
    setError('')
    try {
      downloadPdf(await protectPdf(new Uint8Array(await pdf.file.arrayBuffer()), password), `${pdfStem(pdf.name)}-protege.pdf`)
      setDone(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const edit = (set) => (e) => (set(e.target.value), setDone(false))

  return (
    <motion.main key="protect" className="work" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
      <section className="stage pdf-stage">
        <iframe src={pdf.url} title="Aperçu du PDF" />
      </section>

      <form className="panel" onSubmit={save}>
        <div>
          <h2 className="file" title={pdf.name}>
            {pdf.name}
          </h2>
          <p className="hint gain-why">Le mot de passe sera demandé à chaque ouverture du PDF. Il est chiffré en AES-256.</p>
        </div>

        <label className="field">
          <span className="field-label">Mot de passe</span>
          <span className="password">
            <input
              type={show ? 'text' : 'password'}
              value={password}
              onChange={edit(setPassword)}
              autoComplete="new-password"
              aria-invalid={short}
              aria-describedby="pw-hint"
              autoFocus
            />
            <button type="button" className="link" onClick={() => setShow((s) => !s)} aria-pressed={show}>
              {show ? 'Masquer' : 'Afficher'}
            </button>
          </span>
          <span id="pw-hint" className="hint" data-error={short}>
            Au moins {MIN} caractères.
          </span>
        </label>

        <label className="field">
          <span className="field-label">Confirmer le mot de passe</span>
          <input type={show ? 'text' : 'password'} value={again} onChange={edit(setAgain)} autoComplete="new-password" aria-invalid={mismatch} />
          {mismatch && <span className="hint" data-error="true">Les deux mots de passe ne sont pas identiques.</span>}
        </label>

        <p className="notice">Gardez ce mot de passe : unpixel ne l’enregistre nulle part. Sans lui, le PDF ne pourra plus être ouvert.</p>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="actions">
          <motion.button type="submit" className="primary" disabled={!ok || busy} whileTap={{ scale: 0.97 }}>
            {busy ? 'Protection…' : 'Protéger et télécharger'}
          </motion.button>
          <p className="hint" role="status">
            {done ? 'PDF protégé téléchargé.' : ''}
          </p>
        </div>
      </form>
    </motion.main>
  )
}
