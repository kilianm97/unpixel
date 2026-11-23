import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { CATEGORIES, TOOL_INFO, categoryOf } from './tools.js'

const spring = { type: 'spring', stiffness: 260, damping: 30 }

// Header menu: one button per kind of file. A kind with several tools opens a small panel listing them.
export function ToolMenu({ mode, onPick }) {
  const [open, setOpen] = useState(null) // id of the category whose panel is open
  const root = useRef(null)
  const current = categoryOf(mode)?.id

  useEffect(() => {
    if (!open) return
    const onDown = (e) => root.current?.contains(e.target) || setOpen(null)
    const onKey = (e) => e.key === 'Escape' && (setOpen(null), root.current?.querySelector(`[data-cat="${open}"]`)?.focus())
    addEventListener('pointerdown', onDown)
    addEventListener('keydown', onKey)
    root.current?.querySelector('.tool-menu button')?.focus()
    return () => (removeEventListener('pointerdown', onDown), removeEventListener('keydown', onKey))
  }, [open])

  const pick = (id) => (setOpen(null), onPick(id))

  return (
    <nav ref={root} className="tools" aria-label="Outils">
      <div className="seg">
        {CATEGORIES.map((c) => {
          const single = c.tools.length === 1
          return (
            <button
              key={c.id}
              type="button"
              data-cat={c.id}
              className="seg-opt"
              aria-current={c.id === current ? 'true' : undefined}
              aria-expanded={single ? undefined : open === c.id}
              aria-haspopup={single ? undefined : 'true'}
              onClick={() => (single ? pick(c.tools[0]) : setOpen((o) => (o === c.id ? null : c.id)))}
            >
              {c.id === current && <motion.span layoutId="cat-pill" className="seg-pill" transition={spring} />}
              <span className="seg-text">
                {c.label}
                {!single && (
                  <svg className="chevron" data-open={open === c.id} viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
                    <path d="M3 4.5l3 3 3-3" />
                  </svg>
                )}
              </span>
            </button>
          )
        })}
      </div>
      <AnimatePresence>
        {open && (
          <motion.ul
            key={open}
            className="tool-menu"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16 }}
          >
            {CATEGORIES.find((c) => c.id === open).tools.map((id) => (
              <li key={id}>
                <button type="button" aria-current={id === mode ? 'page' : undefined} onClick={() => pick(id)}>
                  <strong>{TOOL_INFO[id].label}</strong>
                  <span>{TOOL_INFO[id].desc}</span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </nav>
  )
}
