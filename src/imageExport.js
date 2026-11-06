import { findQuality, pixelsOf } from './compress.js'

// Image export shared by the single-image workspace and the batch tool.
export const FORMATS = {
  png: { type: 'image/png', label: 'PNG', ext: 'png', lossy: false },
  jpeg: { type: 'image/jpeg', label: 'JPG', ext: 'jpg', lossy: true },
  webp: { type: 'image/webp', label: 'WebP', ext: 'webp', lossy: true },
}
export const fmt = (b) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} Ko` : `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`)

export function draw(img, r, w, h, background) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (background) (ctx.fillStyle = background), ctx.fillRect(0, 0, w, h)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, w, h)
  return canvas
}

export const toBlob = (canvas, type, quality) =>
  new Promise((ok, fail) =>
    canvas.toBlob((b) => (b ? ok(b) : fail(new Error('L’export a échoué. Essayez une taille plus petite.'))), type, quality),
  )

export const MAX_SIDE = 8000 // export size cap: keeps canvases within browser limits

// Reads an image file into a decoded <img>. The caller revokes the returned url.
export async function decode(file) {
  if (!file?.type.startsWith('image/')) throw new Error('Ce fichier n’est pas une image. Utilisez un PNG, JPG ou WebP.')
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.src = url
  try {
    await img.decode()
  } catch {
    URL.revokeObjectURL(url)
    throw new Error('Impossible de lire cette image. Essayez de l’exporter en PNG.')
  }
  if (!img.naturalWidth || !img.naturalHeight) {
    URL.revokeObjectURL(url)
    throw new Error('Cette image n’a pas de dimensions. Exportez-la en PNG.')
  }
  const name = file.name.replace(/\.[^.]+$/, '') || 'image'
  if (file.type === 'image/svg+xml') {
    // An SVG without width/height decodes at a default 150 px and ignores source rectangles in drawImage:
    // render it once, large and sharp, and work from that bitmap like any other image.
    const k = 2000 / Math.max(img.naturalWidth, img.naturalHeight)
    const c = document.createElement('canvas')
    c.width = Math.round(img.naturalWidth * k)
    c.height = Math.round(img.naturalHeight * k)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    URL.revokeObjectURL(url)
    const raster = URL.createObjectURL(await toBlob(c, 'image/png'))
    const bmp = new Image()
    bmp.src = raster
    await bmp.decode()
    return { img: bmp, url: raster, name, bytes: file.size, type: 'image/png' }
  }
  return { img, url, name, bytes: file.size, type: file.type }
}

// Draws region r of img at w×h and encodes it with the chosen format and compression ({ format, compression, quality }).
// Returns { blob, q } (q = quality used), or null when cancelled during the optimal search.
export async function exportImage(img, r, w, h, out, cancelled = () => false) {
  const f = FORMATS[out.format]
  const canvas = draw(img, r, w, h, f.type === 'image/jpeg' ? '#fff' : null) // JPG has no transparency
  const encode = (q) => toBlob(canvas, f.type, q / 100)
  let blob, q
  if (!f.lossy) blob = await toBlob(canvas, f.type)
  else if (out.compression === 'none') blob = await encode(100)
  else if (out.compression === 'manual') blob = await encode((q = out.quality))
  else {
    const ref = canvas.getContext('2d').getImageData(0, 0, w, h).data
    const found = await findQuality(encode, (b) => pixelsOf(b, w, h), ref, { cancelled })
    if (!found) return null
    ;({ blob, q } = found)
  }
  if (blob.type !== f.type) throw new Error(`Votre navigateur ne sait pas créer de ${f.label}. Choisissez un autre format.`)
  return { blob, q }
}

// Batch output size: the image keeps its size, within the canvas limit
export function batchSize(W, H) {
  const k = Math.min(1, MAX_SIDE / Math.max(W, H))
  return { w: Math.max(1, Math.round(W * k)), h: Math.max(1, Math.round(H * k)) }
}

// Same base name twice in a ZIP would overwrite: photo.webp, photo-2.webp…
export function uniqueNames(names) {
  const seen = new Map()
  return names.map((raw) => {
    // Names can come from a share: no folders, drive letters or control characters inside the ZIP
    const n = raw.replace(/[\\/:\x00-\x1f]/g, '_').replace(/^\.+/, '') || 'image'
    const dot = n.lastIndexOf('.')
    const [stem, ext] = dot > 0 ? [n.slice(0, dot), n.slice(dot)] : [n, '']
    let name = n
    for (let i = 2; seen.has(name.toLowerCase()); i++) name = `${stem}-${i}${ext}`
    seen.set(name.toLowerCase(), true)
    return name
  })
}
