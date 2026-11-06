import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { GTM_ID, isGtmId, readConsent, writeConsent, startGtm, updateGtm, gtmStarted, clearTrackingCookies } from './consent.js'
import { at } from './base.js'

const spring = { type: 'spring', stiffness: 300, damping: 30 }
export const cookiesEnabled = isGtmId(GTM_ID) // no tracker configured → no banner, nothing to consent to
export const openCookieSettings = () => dispatchEvent(new Event('unpixel:cookies'))

// One optional category (audience measurement). Refuse and accept have the same weight.
export function CookieBanner() {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState(null)
  const panel = useRef(null)

  useEffect(() => {
    if (!cookiesEnabled) return
    const saved = readConsent()
    setCurrent(saved)
    if (!saved) setOpen(true)
    else if (saved.audience) startGtm(GTM_ID, saved)
    const onOpen = () => setOpen(true)
    addEventListener('unpixel:cookies', onOpen)
    return () => removeEventListener('unpixel:cookies', onOpen)
  }, [])

  useEffect(() => {
    if (open) panel.current?.focus()
  }, [open])

  function save(audience) {
    const choice = { audience }
    writeConsent(choice)
    setCurrent(choice)
    setOpen(false)
    if (audience) return gtmStarted() ? updateGtm(choice) : startGtm(GTM_ID, choice)
    clearTrackingCookies()
    if (gtmStarted()) {
      updateGtm(choice)
      location.reload() // GTM can't be unloaded: reload without it
    }
  }

  if (!cookiesEnabled) return null

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panel}
          className="cookies"
          role="dialog"
          aria-modal="false"
          aria-labelledby="cookies-title"
          tabIndex={-1}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={spring}
        >
          <h2 id="cookies-title">Vos fichiers restent chez vous. Et vos visites ?</h2>
          <p>
            Avec votre accord, nous mesurons la fréquentation du site avec Google Tag Manager : pages vues, appareil, pays approximatif. Ces données sont traitées par
            Google, y compris aux États-Unis. Vos images et vidéos ne sont jamais concernées. <a href={at('confidentialite.html')}>Politique de confidentialité</a>
          </p>
          {current && <p className="hint">Votre choix actuel : {current.audience ? 'mesure d’audience acceptée' : 'mesure d’audience refusée'}.</p>}
          <div className="cookie-actions">
            <button className="secondary" onClick={() => save(false)}>
              Refuser
            </button>
            <button className="secondary" onClick={() => save(true)}>
              Accepter
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
