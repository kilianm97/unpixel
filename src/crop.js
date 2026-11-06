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

// Social formats. `ratio` is width / height in pixels; `size` also sets the exact export size.
export const CROP_PRESETS = [
  { id: 'free', label: 'Libre' },
  { id: '1:1', label: 'Carré 1:1', ratio: 1 },
  { id: '4:5', label: 'Portrait 4:5', ratio: 4 / 5 },
  { id: '9:16', label: 'Story 9:16', ratio: 9 / 16 },
  { id: '16:9', label: 'Paysage 16:9', ratio: 16 / 9 },
  { id: 'og', label: 'Aperçu de lien 1200 × 630', ratio: 1200 / 630, size: [1200, 630] },
]

// A pixel ratio expressed in fraction space (fractions of a W×H image)
export const fractionAspect = (ratio, W, H) => (ratio * H) / W

// Largest centred rectangle with that aspect
export function fitAspect(k) {
  const w = k < 1 ? k : 1
  const h = k < 1 ? 1 : 1 / k
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h }
}

// Corner drag that keeps aspect k: the opposite corner stays put, the larger pointer move wins.
export function dragRectAspect(mode, r, dx, dy, k) {
  if (mode === 'move') return dragRect('move', r, dx, dy)
  const west = mode.includes('w'), north = mode.includes('n')
  const ax = west ? r.x + r.w : r.x, ay = north ? r.y + r.h : r.y
  const dw = west ? -dx : dx, dh = (north ? -dy : dy) * k
  const maxW = Math.min(west ? ax : 1 - ax, (north ? ay : 1 - ay) * k)
  const w = clamp(r.w + (Math.abs(dw) > Math.abs(dh) ? dw : dh), Math.min(MIN, maxW), maxW)
  const h = w / k
  return { x: west ? ax - w : ax, y: north ? ay - h : ay, w, h }
}

// Rectangle drawn from point a towards b, keeping aspect k
export function spanRectAspect(a, b, k) {
  const right = b.x >= a.x, down = b.y >= a.y
  const maxW = Math.min(right ? 1 - a.x : a.x, (down ? 1 - a.y : a.y) * k)
  const w = clamp(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y) * k), Math.min(MIN, maxW), maxW)
  const h = w / k
  return { x: right ? a.x : a.x - w, y: down ? a.y : a.y - h, w, h }
}
