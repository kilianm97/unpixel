import { motion } from 'motion/react'

// Small controls shared by the tools
const spring = { type: 'spring', stiffness: 260, damping: 30 }

export function Segmented({ label, value, options, onChange }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className="seg-opt" onClick={() => onChange(v)}>
          {value === v && <motion.span layoutId={`seg-${label}`} className="seg-pill" transition={spring} />}
          <span className="seg-text">{text}</span>
        </button>
      ))}
    </div>
  )
}

export function Switch({ checked, onChange, label, hint, disabled }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
      <span className="track">
        {/* slides 18 px (track 46 − padding 6 − thumb 22); no layout animation, so it stays put when the panel above changes height */}
        <motion.span className="thumb" initial={false} animate={{ x: checked ? 18 : 0 }} transition={spring} />
      </span>
      <span>
        {label}
        {hint && <span className="hint switch-hint">{hint}</span>}
      </span>
    </label>
  )
}

export function Slider({ label, hint, value, ...props }) {
  return (
    <label className="slider">
      <span className="slider-head">
        {label} <output>{value}</output>
      </span>
      <input type="range" value={value} {...props} style={{ '--p': `${((value - props.min) / (props.max - props.min)) * 100}%` }} />
      <span className="hint">{hint}</span>
    </label>
  )
}
