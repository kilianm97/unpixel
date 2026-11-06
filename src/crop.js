// Crop rectangles are fractions of the image (0..1), so they don't depend on the on-screen size.
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
export const MIN = 0.02
export const FULL = { x: 0, y: 0, w: 1, h: 1 }

// mode: 'move' or a corner ('nw', 'ne', 'sw', 'se'); dx/dy are fractions too.
export function dragRect(mode, r, dx, dy) {
  if (mode === 'move') return { ...r, x: clamp(r.x + dx, 0, 1 - r.w), y: clamp(r.y + dy, 0, 1 - r.h) }
  let x1 = r.x, y1 = r.y, x2 = r.x + r.w, y2 = r.y + r.h
  if (mode.includes('w')) x1 = clamp(x1 + dx, 0, x2 - MIN)
  if (mode.includes('e')) x2 = clamp(x2 + dx, x1 + MIN, 1)
  if (mode.includes('n')) y1 = clamp(y1 + dy, 0, y2 - MIN)
  if (mode.includes('s')) y2 = clamp(y2 + dy, y1 + MIN, 1)
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

// Rectangle drawn from point a to point b, in any direction.
export function spanRect(a, b) {
  const x1 = clamp(Math.min(a.x, b.x), 0, 1 - MIN), y1 = clamp(Math.min(a.y, b.y), 0, 1 - MIN)
  const x2 = clamp(Math.max(a.x, b.x), x1 + MIN, 1), y2 = clamp(Math.max(a.y, b.y), y1 + MIN, 1)
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

export function cropPixels(r, W, H) {
  const x = Math.round(r.x * W), y = Math.round(r.y * H)
  return { x, y, w: Math.max(1, Math.min(W - x, Math.round(r.w * W))), h: Math.max(1, Math.min(H - y, Math.round(r.h * H))) }
}

export const isFull = (r) => r.x <= 0 && r.y <= 0 && r.w >= 1 && r.h >= 1
