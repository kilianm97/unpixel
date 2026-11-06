import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { HexColorPicker, HexColorInput } from 'react-colorful'

const spring = { type: 'spring', stiffness: 420, damping: 32 }

// A palette swatch that opens a colour picker to replace that colour in the SVG.
// `original` is the traced colour, `value` what it is replaced with (same when unchanged).
export function ColorSwatch({ original, value, onChange }) {
  const [open, setOpen] = useState(false)
  const root = useRef(null)
  const button = useRef(null)
  const changed = value !== original
  const set = (c) => onChange(c.toLowerCase())
  const close = () => (setOpen(false), button.current?.focus())

  useEffect(() => {
    if (!open) return
    const onDown = (e) => root.current?.contains(e.target) || setOpen(false)
    const onKey = (e) => e.key === 'Escape' && close()
    addEventListener('pointerdown', onDown)
    addEventListener('keydown', onKey)
    return () => (removeEventListener('pointerdown', onDown), removeEventListener('keydown', onKey))
  }, [open])

  async function eyedrop() {
    try {
      const { sRGBHex } = await new window.EyeDropper().open()
      set(sRGBHex)
    } catch {
      // cancelled with Escape: keep the current colour
    }
  }

  return (
    <div className="swatch-wrap" ref={root}>
      <motion.button
        ref={button}
        type="button"
        className="swatch"
        data-changed={changed}
        style={{ background: value }}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={changed ? `Couleur ${original} remplacée par ${value}, modifier` : `Remplacer la couleur ${original}`}
        title={changed ? `${original} → ${value}` : `Remplacer ${original}`}
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.9 }}
      />
      <AnimatePresence>
        {open && (
          <motion.div
            className="picker"
            role="dialog"
            aria-label={`Remplacer la couleur ${original}`}
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={spring}
          >
            <HexColorPicker color={value} onChange={set} />
            <div className="picker-row">
              <span className="picker-was" style={{ background: original }} title={`Couleur d’origine : ${original}`} aria-hidden="true" />
              <label className="picker-hex">
                <span aria-hidden="true">#</span>
                <HexColorInput color={value} onChange={set} aria-label="Code hexadécimal" autoFocus />
              </label>
              {'EyeDropper' in window && (
                <button type="button" className="picker-icon" onClick={eyedrop} aria-label="Prendre une couleur à l’écran" title="Pipette">
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path d="M14.5 4.5l5 5M17 2l5 5-3 3-5-5zM14 7l-9.5 9.5L3 21l4.5-1.5L17 10" />
                  </svg>
                </button>
              )}
            </div>
            <div className="picker-actions">
              {changed && (
                <button type="button" className="link" onClick={() => set(original)}>
                  Couleur d’origine
                </button>
              )}
              <button type="button" className="primary small" onClick={close}>
                OK
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
