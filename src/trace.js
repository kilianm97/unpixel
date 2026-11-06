// Image → one binary mask per color. The worker runs potrace on each mask, then assembleSvg stacks them.

// Precision 1 (clean, small specks dropped) → 5 (faithful). turdsize is in *source* pixels (the worker scales it).
export const PRECISION = [
  { turdsize: 200, opttolerance: 0.8 },
  { turdsize: 60, opttolerance: 0.4 },
  { turdsize: 20, opttolerance: 0.2 },
  { turdsize: 6, opttolerance: 0.1 },
  { turdsize: 2, opttolerance: 0.05 },
]
// Corners 0 (sharp polygons) → 4 (round): potrace alphamax
export const CORNERS = [0, 0.6, 1, 1.15, 1.3]

// Work-resolution settings. Smoothing and speck removal follow the source size, but are capped:
// on a tiny logo (37 px wide) one source pixel is a whole stroke, and blurring or dropping it erases real details.
export function workParams({ detail, smooth, corners, outW, outH }, scale) {
  const { turdsize, opttolerance } = PRECISION[detail - 1]
  const speck = Math.min(turdsize, (outW * outH) / 1000) // never more than 0.1 % of the image
  return {
    smooth: Math.round(smooth * 0.75 * Math.min(scale, 2.5)),
    potrace: {
      turdsize: Math.round(speck * scale ** 2), // an area: scales with the work resolution
      // Tuned at the usual ~2.25× upscale; a 27× upscale would otherwise follow interpolation ripples and bloat the SVG
      opttolerance: opttolerance * Math.max(1, scale / 2.25),
      alphamax: CORNERS[corners],
      turnpolicy: 4,
      opticurve: 1,
      extractcolors: false,
      pathonly: false,
    },
  }
}

const CLEAR = 255
const dist = (p, c) => Math.abs(p.r - c.r) + Math.abs(p.g - c.g) + Math.abs(p.b - c.b)
const hex = ({ r, g, b }) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')

// Up to n most frequent *distinct* opaque colors. Logos are flat colors; anti-aliasing pixels are spread
// over many rare bins, so the frequency floor keeps halos out instead of wasting a slot on them.
export function seedPalette({ data }, n) {
  const minDist = Math.max(24, 120 - n * 6) // more colors asked = finer distinctions allowed
  const bins = new Map()
  let opaque = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    opaque++
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4)
    let b = bins.get(key)
    if (!b) bins.set(key, (b = { r: 0, g: 0, b: 0, n: 0 }))
    b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2]; b.n++
  }
  const floor = opaque * 0.001
  const pal = []
  for (const b of [...bins.values()].sort((x, y) => y.n - x.n)) {
    if (pal.length === n || b.n < floor) break
    const c = { r: Math.round(b.r / b.n), g: Math.round(b.g / b.n), b: Math.round(b.b / b.n) }
    if (pal.some((p) => dist(p, c) <= minDist)) continue
    if (b.n < opaque * 0.03 && isBlend(c, pal)) continue // anti-aliasing edge between two kept colors
    pal.push(c)
  }
  return pal
}

// True when c sits on the line between two palette colors (what edge pixels look like).
function isBlend(c, pal) {
  for (let i = 0; i < pal.length; i++)
    for (let j = i + 1; j < pal.length; j++) {
      const a = pal[i], b = pal[j]
      const d = [b.r - a.r, b.g - a.g, b.b - a.b]
      const t = ((c.r - a.r) * d[0] + (c.g - a.g) * d[1] + (c.b - a.b) * d[2]) / (d[0] ** 2 + d[1] ** 2 + d[2] ** 2)
      if (t > 0.05 && t < 0.95 && dist(c, { r: a.r + t * d[0], g: a.g + t * d[1], b: a.b + t * d[2] }) < 36) return true
    }
  return false
}

// Nearest palette color, except for edge pixels: a blend of two colors goes to the closer of *those two*,
// never to a third color that happens to be nearer (dark text on white must not get a pink outline).
export function labelPixels({ data }, pal) {
  const labels = new Uint8Array(data.length / 4)
  const pairs = []
  for (let a = 0; a < pal.length; a++)
    for (let b = a + 1; b < pal.length; b++) {
      const d = [pal[b].r - pal[a].r, pal[b].g - pal[a].g, pal[b].b - pal[a].b]
      pairs.push({ a, b, d, len2: d[0] ** 2 + d[1] ** 2 + d[2] ** 2 || 1 })
    }
  for (let p = 0, i = 0; p < labels.length; p++, i += 4) {
    if (data[i + 3] < 128) { labels[p] = CLEAR; continue }
    const c = { r: data[i], g: data[i + 1], b: data[i + 2] }
    let best = 0, bd = Infinity
    for (let k = 0; k < pal.length; k++) {
      const d = dist(pal[k], c)
      if (d < bd) { bd = d; best = k }
    }
    if (bd > 30) {
      let lineD = bd / 2 // a blend must explain the pixel clearly better than the nearest color
      for (const { a, b, d, len2 } of pairs) {
        const A = pal[a]
        const t = ((c.r - A.r) * d[0] + (c.g - A.g) * d[1] + (c.b - A.b) * d[2]) / len2
        if (t <= 0 || t >= 1) continue
        const ld = dist(c, { r: A.r + t * d[0], g: A.g + t * d[1], b: A.b + t * d[2] })
        if (ld < lineD) { lineD = ld; best = t < 0.5 ? a : b }
      }
    }
    labels[p] = best
  }
  return labels
}

// Clears every pixel of the background color (top-left pixel), including the holes of "e", "p", "o".
export function dropBackground(labels) {
  const bg = labels[0]
  if (bg === CLEAR) return
  for (let p = 0; p < labels.length; p++) if (labels[p] === bg) labels[p] = CLEAR
}

// One box-blur pass (horizontal then vertical) with running sums; edges are clamped.
function boxBlur(src, w, h, r) {
  const tmp = new Uint8Array(src.length), out = new Uint8Array(src.length), d = 2 * r + 1
  for (let y = 0; y < h; y++) {
    const row = y * w
    let s = 0
    for (let x = -r; x <= r; x++) s += src[row + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = s / d
      s += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / d
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
    }
  }
  return out
}

// RGBA mask for potrace: black = this color. Grows 1px into neighbouring opaque colors so touching shapes overlap (no seams).
// smooth > 0 blurs then re-thresholds at 50%: removes small bumps of the source edge without moving the shape.
export function mask(labels, w, h, k, smooth = 0) {
  let m = new Uint8Array(labels.length)
  for (let p = 0; p < labels.length; p++) {
    const l = labels[p]
    const x = p % w
    const on =
      l === k ||
      (l !== CLEAR &&
        ((x > 0 && labels[p - 1] === k) || (x < w - 1 && labels[p + 1] === k) ||
          (p >= w && labels[p - w] === k) || (p < labels.length - w && labels[p + w] === k)))
    if (on) m[p] = 255
  }
  if (smooth > 0) m = boxBlur(boxBlur(m, w, h, smooth), w, h, smooth) // two passes ≈ gaussian
  const out = new Uint8ClampedArray(labels.length * 4).fill(255)
  for (let p = 0; p < m.length; p++) if (m[p] >= 128) out[p * 4] = out[p * 4 + 1] = out[p * 4 + 2] = 0
  return out
}

// Length of the contours in a potrace mask (pixels whose right or lower neighbour differs): a cheap complexity
// measure that predicts potrace time and SVG size before running it.
export function edgeCount(rgba, w) {
  const n = rgba.length / 4
  let e = 0
  for (let p = 0; p < n; p++) {
    const v = rgba[p * 4]
    if ((p % w < w - 1 && rgba[(p + 1) * 4] !== v) || (p + w < n && rgba[(p + w) * 4] !== v)) e++
  }
  return e
}
// Above this many contour pixels (in source pixels, all colors), the image is a photo, not a logo.
// Measured: a 5-color logo ≈ 10k, a busy photo ≈ 64k (which keeps potrace busy for minutes).
export const MAX_EDGES = 40000

// Largest color first so small details are painted on top. Masks are built on demand (one at a time) to cap memory.
export function colorLayers(imgd, { colors = 8, transparent = true, smooth = 0 } = {}) {
  const { width: w, height: h } = imgd
  const pal = seedPalette(imgd, colors)
  const labels = labelPixels(imgd, pal)
  if (transparent) dropBackground(labels)
  const counts = new Array(pal.length).fill(0)
  for (const l of labels) if (l !== CLEAR) counts[l]++
  return pal
    .map((c, k) => ({ hex: hex(c), k, n: counts[k] }))
    .filter((l) => l.n > 0)
    .sort((a, b) => b.n - a.n)
    .map(({ hex, k }) => ({ hex, mask: () => mask(labels, w, h, k, smooth) }))
}

// Swap fill colors in one pass ({ '#ed1b54': '#0055ff' }), so A→B and B→C never chain into A→C.
export const recolorSvg = (svg, map) => svg.replace(/fill="(#[0-9a-f]{6})"/gi, (m, c) => `fill="${map[c.toLowerCase()] ?? c}"`)

// Potrace emits coordinates ×10 with a flipped y axis; one <path> per color keeps the file easy to edit.
export function assembleSvg(layers, w, h, outW = w, outH = h) {
  let shapes = 0
  const palette = []
  const body = layers
    .map(({ hex, svg }) => {
      const ds = [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1].trim())
      if (!ds.length) return ''
      shapes += ds.length
      palette.push(hex)
      return `<path fill="${hex}" d="${ds.join(' ')}"/>`
    })
    .join('')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${outW}" height="${outH}">` +
    `<g transform="translate(0,${h}) scale(0.1,-0.1)">${body}</g></svg>`
  return { svg, paths: shapes, palette }
}
