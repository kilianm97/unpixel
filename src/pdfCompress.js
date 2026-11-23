// PDF compression: images make up most of a PDF's weight, so they are downscaled to what the page can show
// and re-encoded in JPEG. Text, vectors and fonts are left as they are, and so stay sharp.
import { PDFDocument, PDFName, PDFNumber, PDFArray, PDFDict, PDFRawStream, PDFBool } from 'pdf-lib'
import { unzlibSync } from 'fflate'

// dpi: resolution kept for an image covering the largest page. quality: JPEG quality.
export const PDF_LEVELS = [
  { id: 'light', label: 'Léger', desc: 'Pour l’e-mail et l’écran', dpi: 96, quality: 60 },
  { id: 'standard', label: 'Standard', desc: 'Bon compromis, lisible à l’impression', dpi: 150, quality: 75 },
  { id: 'high', label: 'Impression', desc: 'Pour imprimer, fichier plus lourd', dpi: 220, quality: 85 },
]

export const isPdfFile = (file) => !!file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name))

// Undo PNG predictors (Predictor ≥ 10): each row starts with its filter type
export function unpredictPng(data, bpp, rowLen) {
  const out = new Uint8Array((data.length / (rowLen + 1)) * rowLen)
  for (let y = 0, i = 0; i < data.length; y++) {
    const filter = data[i++]
    const row = y * rowLen
    for (let x = 0; x < rowLen; x++, i++) {
      const a = x >= bpp ? out[row + x - bpp] : 0
      const b = y ? out[row - rowLen + x] : 0
      const c = y && x >= bpp ? out[row - rowLen + x - bpp] : 0
      let v = data[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      } else if (filter !== 0) throw new Error('prédicteur PNG inconnu')
      out[row + x] = v
    }
  }
  return out
}

// Components of a colour space this tool can re-encode: grey (1) or RGB (3). Anything else (CMYK, indexed, Lab…) is kept.
function components(cs) {
  if (cs === PDFName.of('DeviceGray')) return 1
  if (cs === PDFName.of('DeviceRGB')) return 3
  if (cs instanceof PDFArray && cs.lookup(0) === PDFName.of('ICCBased')) {
    const n = cs.lookup(1)?.dict?.lookup(PDFName.of('N'))
    return n instanceof PDFNumber && [1, 3].includes(n.asNumber()) ? n.asNumber() : null
  }
  return null
}

const num = (dict, key) => {
  const v = dict.lookup(PDFName.of(key))
  return v instanceof PDFNumber ? v.asNumber() : undefined
}

// What recompress() receives for one image: its JPEG bytes, or its decoded pixels as RGBA. null: kept as it is.
function source(stream) {
  const d = stream.dict
  const get = (k) => d.lookup(PDFName.of(k))
  let filter = get('Filter')
  if (filter instanceof PDFArray) filter = filter.size() === 1 ? filter.lookup(0) : null
  const comps = components(get('ColorSpace'))
  const width = num(d, 'Width'), height = num(d, 'Height')
  if (!comps || !width || !height || num(d, 'BitsPerComponent') !== 8) return null
  if (get('ImageMask') === PDFBool.True || get('Decode') || get('Mask') instanceof PDFArray) return null // inverted, stencil or colour-key masked
  if (filter === PDFName.of('DCTDecode')) return { jpeg: stream.contents, comps }
  if (filter !== PDFName.of('FlateDecode')) return null // JBIG2, CCITT, JPX… stay as they are
  let raw = unzlibSync(stream.contents)
  const parms = get('DecodeParms')
  const predictor = parms instanceof PDFDict ? (num(parms, 'Predictor') ?? 1) : 1
  if (predictor >= 10) raw = unpredictPng(raw, comps, comps * width)
  else if (predictor !== 1) return null
  if (raw.length < width * height * comps) return null
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let p = 0; p < width * height; p++) {
    rgba[p * 4] = raw[p * comps]
    rgba[p * 4 + 1] = raw[p * comps + (comps === 3 ? 1 : 0)]
    rgba[p * 4 + 2] = raw[p * comps + (comps === 3 ? 2 : 0)]
    rgba[p * 4 + 3] = 255
  }
  return { rgba, width, height, comps }
}

// recompress({ jpeg } | { rgba, width, height }, maxSide, quality) → { bytes, width, height }: a 3-channel JPEG, never upscaled.
// Returns { bytes, images, changed }. Throws a message the user can act on.
export async function compressPdf(input, level, recompress, cancelled = () => false) {
  let doc
  try {
    // ignoreEncryption, then isEncrypted: pdf-lib's own error class can't be told apart with instanceof
    doc = await PDFDocument.load(input, { updateMetadata: false, ignoreEncryption: true })
  } catch {
    throw new Error('Impossible de lire ce PDF. Il est peut-être endommagé.')
  }
  if (doc.isEncrypted) throw new Error('Ce PDF est protégé par un mot de passe. Enregistrez-en une copie sans protection, puis déposez-la.')
  const pages = doc.getPages().map((p) => p.getSize())
  if (!pages.length) throw new Error('Ce PDF ne contient aucune page.')
  // An image never needs more pixels than the largest page shows at the chosen resolution
  const maxSide = Math.round((Math.max(...pages.map((p) => Math.max(p.width, p.height))) / 72) * level.dpi)

  const images = doc.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFRawStream && o.dict.lookup(PDFName.of('Subtype')) === PDFName.of('Image'))
  // Soft masks and stencils must stay greyscale and lossless: never touch them
  const masks = new Set(images.flatMap(([, o]) => ['SMask', 'Mask'].map((k) => o.dict.get(PDFName.of(k))?.toString()).filter(Boolean)))

  let changed = 0
  for (const [ref, stream] of images) {
    if (cancelled()) return null
    if (masks.has(ref.toString())) continue
    let src
    try {
      src = source(stream)
    } catch {
      continue // an image this tool can't decode is kept as it is
    }
    if (!src) continue
    const out = await recompress(src, maxSide, level.quality)
    if (!out || out.bytes.length >= stream.contents.length) continue
    const dict = stream.dict.clone(doc.context)
    dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'))
    dict.delete(PDFName.of('DecodeParms'))
    dict.set(PDFName.of('Width'), PDFNumber.of(out.width))
    dict.set(PDFName.of('Height'), PDFNumber.of(out.height))
    dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8))
    if (src.comps === 1) dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB')) // the JPEG is 3-channel
    doc.context.assign(ref, PDFRawStream.of(dict, out.bytes))
    changed++
  }
  if (cancelled()) return null
  const bytes = await doc.save({ useObjectStreams: true, updateFieldAppearances: false })
  // Never hand back a heavier file
  return bytes.length < input.length ? { bytes, images: images.length - masks.size, changed } : { bytes: input, images: images.length - masks.size, changed: 0 }
}

/* ---------- browser side ---------- */

export async function recompressInBrowser(src, maxSide, quality) {
  const bmp = src.jpeg
    ? await createImageBitmap(new Blob([src.jpeg], { type: 'image/jpeg' }), { imageOrientation: 'none' }) // a PDF ignores EXIF rotation
    : await createImageBitmap(new ImageData(src.rgba, src.width, src.height))
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k))
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: quality / 100 })
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: w, height: h }
}
