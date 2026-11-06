import { useRef, useState } from 'react'
import { motion } from 'motion/react'
import { dragRect, spanRect, cropPixels, FULL, CROP_PRESETS, fractionAspect, fitAspect, dragRectAspect, spanRectAspect } from './crop.js'

// Crop editor shared by the single image and the batch: free or social-format area, in fractions of the image.
export function Cropper({ url, initial, initialPreset = 'free', natural, onApply, onCancel }) {
  const [r, setR] = useState(initial)
  const [presetId, setPresetId] = useState(initialPreset)
  const preset = CROP_PRESETS.find((p) => p.id === presetId)
  const k = preset.ratio ? fractionAspect(preset.ratio, natural.w, natural.h) : null // locked aspect, in fraction space
  function choose(p) {
    setPresetId(p.id)
    if (p.ratio) setR(fitAspect(fractionAspect(p.ratio, natural.w, natural.h)))
  }
  const wrap = useRef(null)
  const drag = useRef(null)
  const point = (e) => {
    const b = wrap.current.getBoundingClientRect()
    return {
      x: (e.clientX - b.left) / b.width,
      y: (e.clientY - b.top) / b.height,
    }
  }
  const start = (mode) => (e) => {
    e.stopPropagation()
    e.preventDefault()
    wrap.current.setPointerCapture(e.pointerId)
    drag.current = { mode, p0: point(e), r0: r }
  }
  const move = (e) => {
    const d = drag.current
    if (!d) return
    const p = point(e)
    const dx = p.x - d.p0.x,
      dy = p.y - d.p0.y
    if (d.mode === 'new') setR(k ? spanRectAspect(d.p0, p, k) : spanRect(d.p0, p))
    else setR(k ? dragRectAspect(d.mode, d.r0, dx, dy, k) : dragRect(d.mode, d.r0, dx, dy))
  }
  const end = () => (drag.current = null)
  const onKey = (e) => {
    const s = e.shiftKey ? 0.05 : 0.01
    const d = {
      ArrowLeft: [-s, 0],
      ArrowRight: [s, 0],
      ArrowUp: [0, -s],
      ArrowDown: [0, s],
    }[e.key]
    if (!d) return
    e.preventDefault()
    setR((r) => (k && e.altKey ? dragRectAspect('se', r, ...d, k) : dragRect(e.altKey ? 'se' : 'move', r, ...d)))
  }
  const px = cropPixels(r, natural.w, natural.h)
  const [x1, y1, x2, y2] = [r.x, r.y, r.x + r.w, r.y + r.h].map((v) => `${v * 100}%`)

  return (
    <section className="stage cropper" aria-label="Rogner l’image">
      <div className="crop-area">
        <div ref={wrap} className="crop-wrap" onPointerDown={start('new')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
          <img src={url} alt="Image à rogner" draggable="false" />
          <div
            className="crop-shade"
            style={{
              clipPath: `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${x1} ${y1}, ${x2} ${y1}, ${x2} ${y2}, ${x1} ${y2}, ${x1} ${y1})`,
            }}
          />
          <div
            className="crop-rect"
            style={{
              left: x1,
              top: y1,
              width: `${r.w * 100}%`,
              height: `${r.h * 100}%`,
            }}
            onPointerDown={start('move')}
            onKeyDown={onKey}
            tabIndex={0}
            role="group"
            aria-label="Zone gardée. Flèches pour déplacer, Alt + flèches pour redimensionner."
          >
            {['nw', 'ne', 'sw', 'se'].map((c) => (
              <span key={c} className={`crop-handle ${c}`} onPointerDown={start(c)} />
            ))}
          </div>
        </div>
      </div>
      <div className="crop-presets" role="radiogroup" aria-label="Format">
        {CROP_PRESETS.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={p.id === presetId} className="crop-preset" onClick={() => choose(p)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="crop-bar">
        <span className="crop-size">
          {px.w} × {px.h} px
        </span>
        <button className="ghost" onClick={() => (setPresetId('free'), setR(FULL))}>
          Image entière
        </button>
        <button className="ghost" onClick={onCancel}>
          Annuler
        </button>
        <motion.button className="primary small" onClick={() => onApply(r, preset)} whileTap={{ scale: 0.97 }}>
          Rogner
        </motion.button>
      </div>
    </section>
  )
}
