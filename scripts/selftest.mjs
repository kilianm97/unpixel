// Run with `npm test`. Checks the color/mask logic (potrace itself runs in the browser worker).
import assert from 'node:assert/strict'
import { seedPalette, labelPixels, dropBackground, mask, colorLayers, assembleSvg, edgeCount, workParams, recolorSvg } from '../src/trace.js'
import { dragRect, spanRect, cropPixels, isFull, FULL, MIN, CROP_PRESETS, fractionAspect, fitAspect, dragRectAspect, spanRectAspect } from '../src/crop.js'
import { psnr, findQuality } from '../src/compress.js'
import { batchSize, uniqueNames } from '../src/imageExport.js'
import { freePath, ffmpegArgs, isRemotePath } from '../mcp/tools.mjs'
import { compressPdf, unpredictPng, PDF_LEVELS } from '../src/pdfCompress.js'
import { PDFDocument, PDFName, PDFRawStream, StandardFonts } from '@cantoo/pdf-lib'
import sharp from 'sharp'
import zlib from 'node:zlib'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseConsent, serializeConsent, consentMode, wantsGtm, isGtmId, isTrackingCookie, cookieDomains } from '../src/consent.js'
import { PRESETS, outputName, targetSize, overCap, clampTrim, fmtTime, isVideoFile, sampleEntryCodes, unreadableVideoMessage, videoCrop } from '../src/videoPresets.js'

// Red ring + red center dot on white; white disc inside the ring. Edges get a few anti-aliasing pixels.
const w = 120, h = 120
const data = new Uint8ClampedArray(w * h * 4).fill(255)
for (let y = 0; y < h; y++)
  for (let x = 0; x < w; x++) {
    const r = Math.hypot(x - 60, y - 60)
    const i = (y * w + x) * 4
    if ((r > 25 && r < 40) || r < 8) data.set([237, 27, 84, 255], i)
    else if (Math.abs(r - 40.5) < 0.5) data.set([246, 141, 169, 255], i) // halo
  }
const img = { width: w, height: h, data }

assert.deepEqual(seedPalette(img, 8).map((c) => [c.r, c.g, c.b]), [[255, 255, 255], [237, 27, 84]], 'exact colors, halo ignored')

const labels = labelPixels(img, seedPalette(img, 8))
dropBackground(labels)
assert.equal(labels[0], 255, 'outer background cleared')
assert.equal(labels[60 * w + 45], 255, 'white inside the ring (letter counter) cleared too')
assert.deepEqual(colorLayers(img).map((l) => l.hex), ['#ed1b54'])

// Edge pixel halfway between dark text and white must not be labeled pink
const pal3 = [{ r: 255, g: 255, b: 255 }, { r: 237, g: 27, b: 84 }, { r: 42, g: 15, b: 28 }]
const edge = labelPixels({ data: Uint8ClampedArray.from([148, 135, 141, 255, 240, 140, 170, 255]) }, pal3)
assert.ok(edge[0] !== 1, 'dark/white blend goes to dark or white')
assert.ok(edge[1] !== 2, 'pink/white blend goes to pink or white')
assert.equal(labelPixels({ data: Uint8ClampedArray.from([237, 27, 84, 255]) }, pal3)[0], 1, 'pure pink stays pink')

const layers = colorLayers(img, { transparent: false })
assert.deepEqual(layers.map((l) => l.hex), ['#ffffff', '#ed1b54'], 'largest color first')
const red = colorLayers(img)[0].mask()
assert.equal(red[(60 * w + 60) * 4], 0, 'dot is in the red mask')
assert.equal(red[(60 * w + 15) * 4], 255, 'cleared background is outside every mask')

// 1px growth into neighbouring opaque colors only
const strip = mask(Uint8Array.from([1, 0, 1, 255, 0]), 5, 1, 0)
assert.deepEqual([0, 1, 2, 3, 4].map((p) => strip[p * 4]), [0, 0, 0, 255, 0])

// Smoothing: a 1px bump on a straight edge disappears, the shape itself stays in place
const sw = 40, sh = 40, sq = new Uint8Array(sw * sh).fill(255)
for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) sq[y * sw + x] = 0
sq[9 * sw + 20] = 0 // bump on the top edge
const raw = mask(sq, sw, sh, 0), smooth = mask(sq, sw, sh, 0, 2)
assert.equal(raw[(9 * sw + 20) * 4], 0, 'bump present without smoothing')
assert.equal(smooth[(9 * sw + 20) * 4], 255, 'bump removed with smoothing')
assert.equal(smooth[(10 * sw + 20) * 4], 0, 'edge stays where it was')
assert.equal(smooth[(20 * sw + 9) * 4], 255, 'shape does not grow')

// Opaque, no transparency: background kept as a layer
assert.equal(colorLayers(img, { transparent: false }).length, 2)
// Already-transparent source
const alpha = new Uint8ClampedArray(data)
for (let i = 0; i < alpha.length; i += 4) if (alpha[i + 1] > 100) alpha[i + 3] = 0
assert.deepEqual(colorLayers({ width: w, height: h, data: alpha }).map((l) => l.hex), ['#ed1b54'])

const potraceOut = '<svg><g><path d="M1 2 c3 4 5 6 7 8z m1 1z"/><path d="M9 9 l1 1z"/></g></svg>'
const out = assembleSvg([{ hex: '#ed1b54', svg: potraceOut }, { hex: '#ffffff', svg: '<svg></svg>' }], 120, 120, 60, 60)
assert.equal(out.svg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="60" height="60"><g transform="translate(0,120) scale(0.1,-0.1)"><path fill="#ed1b54" d="M1 2 c3 4 5 6 7 8z m1 1z M9 9 l1 1z"/></g></svg>')
assert.equal(out.paths, 2)
assert.deepEqual(out.palette, ['#ed1b54'], 'empty layers skipped')

// Crop rectangle logic
const near = (r, e) => Object.keys(e).every((k) => Math.abs(r[k] - e[k]) < 1e-9)
assert.ok(near(dragRect('move', { x: 0.5, y: 0.5, w: 0.4, h: 0.4 }, 0.5, -1), { x: 0.6, y: 0, w: 0.4, h: 0.4 }), 'move stays inside')
assert.ok(near(dragRect('nw', FULL, 0.25, 0.1), { x: 0.25, y: 0.1, w: 0.75, h: 0.9 }), 'corner resize')
assert.ok(near(dragRect('se', { x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, -2, -2), { x: 0.2, y: 0.2, w: MIN, h: MIN }), 'never inverts')
assert.ok(near(spanRect({ x: 0.8, y: 0.9 }, { x: 0.2, y: 1.5 }), { x: 0.2, y: 0.9, w: 0.6, h: 0.1 }), 'drawn in any direction, clamped')
assert.deepEqual(cropPixels({ x: 0.25, y: 0.5, w: 0.5, h: 0.5 }, 2172, 724), { x: 543, y: 362, w: 1086, h: 362 })
assert.deepEqual(cropPixels({ x: 0.999, y: 0, w: 0.02, h: 1 }, 100, 100), { x: 100, y: 0, w: 1, h: 100 }, 'at least 1px')
assert.ok(isFull(FULL) && !isFull({ x: 0, y: 0, w: 0.99, h: 1 }))

// Contour length: 4×4 square in a 6×6 mask → 4 (left of it) + 4 (above) + 4 (its right column) + 3 (its bottom row, corner already counted)
const box = mask(Uint8Array.from({ length: 36 }, (_, p) => (p % 6 >= 1 && p % 6 <= 4 && p >= 6 && p < 30 ? 0 : 255)), 6, 6, 0)
assert.equal(edgeCount(box, 6), 15, 'contour pixels counted')
assert.equal(edgeCount(new Uint8ClampedArray(36 * 4).fill(255), 6), 0, 'empty mask has no contour')

// Social video crop
assert.deepEqual(videoCrop(1920, 1080, 9 / 16), { left: 658, top: 0, width: 606, height: 1080 }, 'vertical from landscape, centred, even size and offset')
assert.deepEqual(videoCrop(1920, 1080, 9 / 16, 0), { left: 0, top: 0, width: 606, height: 1080 }, 'slid to the left')
assert.deepEqual(videoCrop(1080, 1920, 1, 1), { left: 0, top: 840, width: 1080, height: 1080 }, 'square from portrait, slid down')
assert.equal(videoCrop(1920, 1080, null), null, 'original: no crop')

// Unreadable video: name the real codec
const stsdBox = (code) => Uint8Array.from([0, 0, 0, 40, ...Buffer.from('stsd'), 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 24, ...Buffer.from(code), 0, 0, 0, 0])
assert.deepEqual(sampleEntryCodes(Uint8Array.from([...stsdBox('ap4h'), ...stsdBox('tmcd')])), ['ap4h', 'tmcd'])
assert.match(unreadableVideoMessage(['ap4h', 'tmcd']), /ProRes/)
assert.match(unreadableVideoMessage(['hvc1']), /HEVC/)
assert.match(unreadableVideoMessage([]), /H\.264/)

// Recolor: one pass, no chaining
const two = '<path fill="#ed1b54" d="M0 0z"/><path fill="#ffffff" d="M1 1z"/>'
assert.equal(recolorSvg(two, { '#ed1b54': '#ffffff', '#ffffff': '#000000' }), '<path fill="#ffffff" d="M0 0z"/><path fill="#000000" d="M1 1z"/>')
assert.equal(recolorSvg(two, {}), two, 'no change without a map')

// Work parameters: tiny logos keep their 1-2 px strokes
const big = workParams({ detail: 3, smooth: 2, corners: 2, outW: 2172, outH: 724 }, 2.25)
assert.equal(big.smooth, 3, 'normal logo: ~1.5 source px of smoothing')
assert.equal(big.potrace.turdsize, Math.round(20 * 2.25 ** 2))
const tiny = workParams({ detail: 3, smooth: 2, corners: 2, outW: 37, outH: 34 }, 27)
assert.ok(tiny.smooth / 27 < 0.15, 'tiny logo: smoothing stays far below one source pixel')
assert.ok(tiny.potrace.turdsize / 27 ** 2 < 1.3, 'tiny logo: specks removed only below ~1 source px²')
assert.equal(big.potrace.opttolerance, 0.2, 'normal logo: curve tolerance unchanged')
assert.ok(Math.abs(tiny.potrace.opttolerance / 27 - 0.2 / 2.25) < 1e-9, 'tiny logo: same tolerance in source pixels')

// Social crop formats keep their pixel ratio
const pxRatio = (r, W, H) => (r.w * W) / (r.h * H)
const k916 = fractionAspect(9 / 16, 1920, 1080)
const story = fitAspect(k916)
assert.ok(Math.abs(pxRatio(story, 1920, 1080) - 9 / 16) < 1e-9 && story.h === 1 && Math.abs(story.x + story.w / 2 - 0.5) < 1e-9, 'story: full height, centred')
const square = fitAspect(fractionAspect(1, 1080, 1920))
assert.ok(Math.abs(pxRatio(square, 1080, 1920) - 1) < 1e-9 && square.w === 1, 'square in a portrait photo: full width')
const grown = dragRectAspect('se', story, 0.5, 0.5, k916)
assert.ok(Math.abs(pxRatio(grown, 1920, 1080) - 9 / 16) < 1e-9 && grown.y + grown.h <= 1 + 1e-9 && grown.x + grown.w <= 1 + 1e-9, 'corner drag keeps ratio and stays inside')
const small = dragRectAspect('nw', { x: 0.4, y: 0.2, w: 0.2, h: 0.2 / k916 }, 0.1, 0.05, k916)
assert.ok(Math.abs(pxRatio(small, 1920, 1080) - 9 / 16) < 1e-9 && Math.abs(small.x + small.w - 0.6) < 1e-9, 'opposite corner stays put')
const drawn = spanRectAspect({ x: 0.9, y: 0.9 }, { x: 0.2, y: 0.85 }, fractionAspect(1, 1920, 1080))
assert.ok(Math.abs(pxRatio(drawn, 1920, 1080) - 1) < 1e-9 && drawn.x >= 0 && drawn.y >= 0 && Math.abs(drawn.x + drawn.w - 0.9) < 1e-9, 'drawn leftwards, clamped, square')
assert.deepEqual(CROP_PRESETS.find((p) => p.id === 'og').size, [1200, 630])

// Optimal compression search
const ref = new Uint8ClampedArray(400).fill(100)
assert.equal(psnr(ref, ref), Infinity)
assert.ok(Math.abs(psnr(ref, ref.map((v) => v + 1)) - 48.13) < 0.01, 'off by one everywhere = 48.13 dB')
assert.equal(psnr(new Uint8ClampedArray([9, 9, 9, 0]), new Uint8ClampedArray([0, 0, 0, 0])), Infinity, 'transparent pixels ignored')
// Fake codec: error shrinks as quality grows; 42 dB is first reached at q = 66 here
const fakeDecode = (q) => ref.map((v, i) => (i % 4 === 3 ? v : v + Math.round((100 - q) / 17)))
const calls = []
const found = await findQuality(async (q) => (calls.push(q), q), async (q) => fakeDecode(q), ref)
const firstOk = [...Array(66).keys()].map((i) => i + 30).find((q) => psnr(ref, fakeDecode(q)) >= 42)
assert.equal(found.q, firstOk, `lowest passing quality (${firstOk})`)
assert.ok(calls.length <= 7, 'binary search, not a scan')
assert.equal((await findQuality(async (q) => q, async () => ref.map((v) => v + 40), ref)).q, 95, 'falls back to top quality')
assert.equal(await findQuality(async (q) => q, async () => ref, ref, { cancelled: () => true }), null)

// Video presets (LightVid recipes)
assert.deepEqual(PRESETS.map((p) => [p.crf, p.maxrate, p.audio, p.suffix]), [[28, 1e6, 96e3, '-720'], [26, 2e6, 128e3, '-1080'], [22, 5e6, 128e3, '-high']])
assert.equal(outputName('Mon clip.final.MOV', PRESETS[0]), 'bmg_Mon clip.final-720.mp4')
assert.deepEqual(targetSize(1920, 1080, 720), { width: 1280, height: 720 })
assert.deepEqual(targetSize(1080, 1920, 720), { width: 406, height: 720 }, 'portrait: height fixed like scale=-2:720, even width')
assert.deepEqual(targetSize(640, 360, 1080), { width: 640, height: 360 }, 'never upscales')
assert.deepEqual(targetSize(1919, 1079, null), { width: 1920, height: 1080 }, 'original size rounded to even')
assert.ok(overCap(2_000_000, 10, PRESETS[0], false), '1.6 Mb/s video > 1 Mb/s cap')
assert.ok(!overCap(1_200_000, 10, PRESETS[0], false), '0.86 Mb/s fits')
assert.ok(!overCap(1, 0, PRESETS[0], false), 'unknown duration never triggers')
assert.deepEqual(clampTrim({ start: 9.9, end: 10 }, 30, 'start'), { start: 9.5, end: 10 }, 'keeps the minimum clip length')
assert.deepEqual(clampTrim({ start: 2, end: 99 }, 30, 'end'), { start: 2, end: 30 }, 'end clamped to duration')
assert.deepEqual(clampTrim({ start: -3, end: 5 }, 30, 'start'), { start: 0, end: 5 })
assert.deepEqual(clampTrim({ start: 0, end: 0.1 }, 0.3, 'end'), { start: 0, end: 0.3 }, 'clip shorter than the minimum: whole clip')
assert.equal(fmtTime(75.04), '01:15.0')
assert.equal(fmtTime(59.96), '01:00.0')
assert.equal(fmtTime(3.25), '00:03.3')
assert.ok(isVideoFile({ type: '', name: 'clip.MKV' }) && isVideoFile({ type: 'video/mp4', name: 'x' }) && !isVideoFile({ type: 'image/png', name: 'a.png' }))

// Cookie consent (nLPD)
const day = 864e5, now = Date.UTC(2026, 10, 6)
const saved = serializeConsent({ audience: true }, now)
assert.deepEqual(parseConsent(saved, now + day), { audience: true, date: now })
assert.equal(parseConsent(saved, now + 366 * day), null, 'asked again after a year')
assert.equal(parseConsent(saved.replace('"v":1', '"v":0'), now), null, 'asked again when the trackers change')
assert.equal(parseConsent('{"v":1,"date":"x","audience":true}', now), null, 'malformed record ignored')
assert.equal(parseConsent('{"v":1,"date":' + (now + 9 * day) + ',"audience":true}', now), null, 'future date ignored')
assert.equal(parseConsent('not json', now), null)
assert.equal(parseConsent(null, now), null)
assert.equal(parseConsent('{"v":1,"date":' + now + ',"audience":"yes"}', now).audience, false, 'only a real true counts as consent')
assert.deepEqual(consentMode({ audience: true }), { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' })
assert.ok(!wantsGtm(null) && !wantsGtm({ audience: false }) && wantsGtm({ audience: true }))
assert.equal(consentMode({ audience: true, marketing: true }).ad_storage, 'denied', 'advertising never granted')
assert.ok(isGtmId('GTM-ABC1234') && !isGtmId('') && !isGtmId('GTM-abc') && !isGtmId('G-ABC1234') && !isGtmId(undefined))
assert.ok(isTrackingCookie('_ga') && isTrackingCookie('_ga_ABC123') && isTrackingCookie('_gcl_au') && !isTrackingCookie('session'))
assert.deepEqual(cookieDomains('www.unpixel.ch'), ['www.unpixel.ch', '.www.unpixel.ch', '.unpixel.ch'])

// Batch: original size within the canvas limit, unique names in the ZIP
assert.deepEqual(batchSize(4000, 3000), { w: 4000, h: 3000 })
assert.deepEqual(batchSize(10000, 20000), { w: 4000, h: 8000 })
assert.deepEqual(uniqueNames(['../../evil.webp', 'C:\\x.webp', '.webp']), ['_.._evil.webp', 'C__x.webp', 'webp'])
assert.deepEqual(uniqueNames(['a.webp', 'A.webp', 'b.webp', 'a.webp', 'a-2.webp']), ['a.webp', 'A-2.webp', 'b.webp', 'a-3.webp', 'a-2-2.webp'])

// PDF: images re-encoded to what the page shows, text and masks untouched, never heavier. sharp stands in for the browser canvas.
{
  const recompress = async (src, maxSide, q) => {
    const img = src.jpeg ? sharp(src.jpeg) : sharp(Buffer.from(src.rgba.buffer), { raw: { width: src.width, height: src.height, channels: 4 } })
    const { data, info } = await img.resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true }).removeAlpha().toColourspace('srgb').jpeg({ quality: q }).toBuffer({ resolveWithObject: true })
    return { bytes: new Uint8Array(data), width: info.width, height: info.height }
  }
  const imagesOf = async (bytes) =>
    (await PDFDocument.load(bytes)).context
      .enumerateIndirectObjects()
      .filter(([, o]) => o instanceof PDFRawStream && o.dict.lookup(PDFName.of('Subtype')) === PDFName.of('Image'))
      .map(([, o]) => `${o.dict.lookup(PDFName.of('Width'))}x${o.dict.lookup(PDFName.of('Height'))} ${o.dict.lookup(PDFName.of('Filter'))}`)
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842]) // A4: 842 pt = 11.7 in
  page.drawImage(await doc.embedJpg(await sharp('public/demo/studio.jpg').resize(3508).jpeg({ quality: 95 }).toBuffer()), { x: 40, y: 400, width: 515, height: 290 })
  // A semi-transparent photo as PNG (a flat-colour PNG would stay: JPEG can't beat it, and the tool keeps the lighter one)
  page.drawImage(await doc.embedPng(await sharp('public/demo/studio.jpg').resize(900, 600).ensureAlpha(0.5).png().toBuffer()), { x: 40, y: 40 })
  page.drawText('Texte', { font: await doc.embedFont(StandardFonts.Helvetica) })
  const grey = zlib.deflateSync(Buffer.from(await sharp('public/demo/studio.jpg').grayscale().raw().toBuffer()))
  page.node.setXObject(PDFName.of('Scan'), doc.context.register(PDFRawStream.of(doc.context.obj({ Type: 'XObject', Subtype: 'Image', Width: 1280, Height: 720, BitsPerComponent: 8, ColorSpace: 'DeviceGray', Filter: 'FlateDecode' }), grey)))
  page.node.setXObject(PDFName.of('Cmyk'), doc.context.register(PDFRawStream.of(doc.context.obj({ Type: 'XObject', Subtype: 'Image', Width: 300, Height: 200, BitsPerComponent: 8, ColorSpace: 'DeviceCMYK', Filter: 'FlateDecode' }), zlib.deflateSync(Buffer.alloc(300 * 200 * 4, 90)))))
  const input = await doc.save()
  const r = await compressPdf(input, PDF_LEVELS.find((l) => l.id === 'standard'), recompress)
  assert.ok(r.bytes.length < input.length / 4, `much lighter: ${input.length} → ${r.bytes.length}`)
  assert.equal(r.images, 4, 'the soft mask of the PNG is not counted')
  assert.deepEqual((await imagesOf(r.bytes)).sort(), [
    '1280x720 /DCTDecode', // the grey scan
    '1754x987 /DCTDecode', // 3508 px downscaled to 11.7 in × 150 dpi
    '300x200 /FlateDecode', // CMYK, kept
    '900x600 /DCTDecode', // the PNG's colour, as JPEG
    '900x600 /FlateDecode', // its soft mask, untouched
  ])
  // Text only: nothing to gain, the original comes back unchanged
  const text = await PDFDocument.create()
  text.addPage().drawText('Bonjour', { font: await text.embedFont(StandardFonts.Helvetica) })
  const textBytes = await text.save()
  const same = await compressPdf(textBytes, PDF_LEVELS[0], recompress)
  assert.ok(same.bytes === textBytes && same.images === 0 && same.changed === 0)
  // Errors the user can act on
  const plain = Buffer.from(await text.save({ useObjectStreams: false })).toString('latin1')
  const locked = Buffer.from(plain.replace(/trailer\s*<</, 'trailer\n<< /Encrypt << /Filter /Standard /V 1 /R 2 /O <00> /U <00> /P -4 >>'), 'latin1')
  await assert.rejects(compressPdf(locked, PDF_LEVELS[1], recompress), /protégé par un mot de passe/)
  await assert.rejects(compressPdf(new TextEncoder().encode('bonjour'), PDF_LEVELS[1], recompress), /Impossible de lire ce PDF/)
  // PNG predictors: each row filter (None, Sub, Up, Average, Paeth) decodes back to the original
  const bpp = 3, rowLen = 21, plainRows = Uint8Array.from({ length: rowLen * 5 }, (_, i) => (i * 37 + 11) & 255)
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
  const encoded = []
  for (let y = 0; y < 5; y++) {
    encoded.push(y)
    for (let x = 0; x < rowLen; x++) {
      const at = (yy, xx) => (yy >= 0 && xx >= 0 ? plainRows[yy * rowLen + xx] : 0)
      const a = at(y, x - bpp), b = at(y - 1, x), c = at(y - 1, x - bpp)
      encoded.push((plainRows[y * rowLen + x] - [0, a, b, (a + b) >> 1, paeth(a, b, c)][y]) & 255)
    }
  }
  assert.deepEqual(unpredictPng(Uint8Array.from(encoded), bpp, rowLen), plainRows)
}

// PDF page tools, read back with pdf.js (the engine browsers use): order, rotation, removal, password
{
  const { mergePdfs, rotatePages, removePages, protectPdf } = await import('../src/pdfTools.js')
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const { degrees } = await import('@cantoo/pdf-lib')
  const make = async (label, n, size = [595, 842], rot = 0) => {
    const d = await PDFDocument.create()
    const font = await d.embedFont(StandardFonts.Helvetica)
    for (let i = 0; i < n; i++) {
      const p = d.addPage(size)
      p.drawText(`${label}${i + 1}`, { x: 50, y: size[1] - 120, size: 24, font })
      if (rot) p.setRotation(degrees(rot))
    }
    return d.save()
  }
  const read = async (bytes, password) => {
    const doc = await pdfjs.getDocument({ data: bytes.slice(), password, verbosity: 0 }).promise
    const pages = []
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i)
      pages.push(`${(await p.getTextContent()).items.map((t) => t.str).join('')}@${p.rotate}`)
    }
    return pages
  }
  const A = await make('A', 2), B = await make('B', 3, [842, 595]), C = await make('C', 1, [595, 842], 90)
  assert.deepEqual(await read(await mergePdfs([C, A, B])), ['C1@90', 'A1@0', 'A2@0', 'B1@0', 'B2@0', 'B3@0'], 'merged in the chosen order')
  await assert.rejects(mergePdfs([A, new TextEncoder().encode('nope')]), /Fichier 2 : Impossible de lire/)
  assert.deepEqual(await read(await rotatePages(B, [1, -1, 2])), ['B1@90', 'B2@270', 'B3@180'])
  assert.deepEqual(await read(await rotatePages(C, [-1])), ['C1@0'], 'adds to the rotation the page already had')
  assert.deepEqual(await read(await removePages(B, [0, 2])), ['B2@0'])
  await assert.rejects(removePages(A, [0, 1]), /au moins une page/)
  const locked = await protectPdf(A, 'Sécurité-123')
  await assert.rejects(read(locked), /password/i, 'no password: refused')
  await assert.rejects(read(locked, 'faux'), /password/i, 'wrong password: refused')
  assert.deepEqual(await read(locked, 'Sécurité-123'), ['A1@0', 'A2@0'])
  assert.match(new TextDecoder('latin1').decode(locked), /\/V 5[\s\S]*\/R 6[\s\S]*\/CFM \/AESV3/, 'AES-256')
  await assert.rejects(mergePdfs([locked]), /protégé par un mot de passe/)
}

// GIF: unchanged pixels become transparent and show the previous frame (dispose 1), so a moving square on a still
// photo decodes right on every frame, and the file is far lighter than storing each frame whole.
{
  const { GIF_PRESETS, createGif, gifPalette, gifTimes, gifSize } = await import('../src/gif.js')
  const W = 240, H = 135, N = 12
  const bg = await sharp('public/demo/studio.jpg').resize(W, H).ensureAlpha().raw().toBuffer()
  const frames = Array.from({ length: N }, (_, i) => {
    const f = Uint8ClampedArray.from(bg)
    for (let p = 0; p < W * H; p++) for (let c = 0; c < 3; c++) f[p * 4 + c] += ((p * 7919 + i * 104729) % 5) - 2 // sensor noise
    for (let y = 50; y < 80; y++) for (let x = 10 + i * 15; x < 40 + i * 15; x++) f.set([237, 27, 84], (y * W + x) * 4)
    return f
  })
  const preset = GIF_PRESETS.find((p) => p.id === 'standard')
  const encode = (p) => {
    const gif = createGif(gifPalette([frames[0], frames[6]], p.colors), W, H, p)
    frames.forEach((f) => gif.add(f))
    return gif.finish().bytes
  }
  const bytes = encode(preset)
  assert.ok(bytes.length < encode({ ...preset, threshold: -1 }).length / 3, 'storing only what moves makes it far lighter')
  const meta = await sharp(bytes, { animated: true }).metadata()
  assert.equal(meta.pages, N)
  assert.equal(meta.delay[0], 80, '12 images/s, rounded to GIF hundredths')
  const raw = await sharp(bytes, { animated: true }).raw().toBuffer()
  const px = (f, x, y) => [...raw.subarray((f * H * W + y * W + x) * meta.channels, (f * H * W + y * W + x) * meta.channels + 3)]
  const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol)
  assert.ok(near(px(10, 175, 65), [237, 27, 84], 12), 'the square is where it moved')
  assert.ok(near(px(10, 20, 65), [...bg.subarray((65 * W + 20) * 4, (65 * W + 20) * 4 + 3)], 40), 'where it was, the photo is back')
  assert.equal(gifTimes(2, 3, 12).length, 12)
  assert.deepEqual(gifSize(1920, 1080, 480), { width: 480, height: 270 })
  assert.deepEqual(gifSize(1080, 1920, 480), { width: 270, height: 480 }, 'vertical: the longest side is capped')
  assert.deepEqual(gifSize(200, 100, 480), { width: 200, height: 100 }, 'never upscaled')
}

// MCP server: output names never overwrite, and the ffmpeg command is the LightVid recipe
const taken = new Set([path.join('d', 'a.webp'), path.join('d', 'a-2.webp')])
assert.equal(freePath('d', 'a', 'webp', (p) => taken.has(p)), path.join('d', 'a-3.webp'))
assert.equal(freePath('d', 'b', 'webp', () => false), path.join('d', 'b.webp'))
const cut = ffmpegArgs('in.mov', 'out.mp4', PRESETS[0], { start: 2, end: 5.5, mute: true }).join(' ')
assert.ok(cut.startsWith('-hide_banner -loglevel error -n ') && cut.includes(' -ss 2 -to 5.5 -i in.mov '), 'cut before the input, never overwrite')
assert.ok(cut.indexOf('-protocol_whitelist file -format_whitelist mov,mp4,') < cut.indexOf(' -i '), 'local video containers only')
// Network shares and device paths are refused (they would take files off this computer)
assert.ok(isRemotePath('\\\\srv\\share\\a.jpg') && isRemotePath(path.win32.resolve('//srv/share/a.jpg')) && isRemotePath('\\\\?\\C:\\a.jpg') && isRemotePath('\\\\.\\PhysicalDrive0'))
assert.ok(!isRemotePath('C:\\photos\\a.jpg') && !isRemotePath('/home/me/a.jpg') && !isRemotePath(path.resolve('a.jpg')))
assert.ok(cut.includes("scale=-2:'trunc(min(720,ih)/2)*2'") && cut.includes('-crf 28 -maxrate 1000000 -bufsize 2000000'))
assert.ok(cut.includes(' -an ') && !cut.includes('aac'), 'muted: no audio track')
const whole = ffmpegArgs('in.mp4', 'out.mp4', PRESETS[2]).join(' ')
assert.ok(whole.includes("scale=-2:'trunc(ih/2)*2'") && whole.includes('-c:a aac -b:a 128000 -ac 2') && !whole.includes('-ss'))

// MCP server, for real: start it, list its tools and run both on the demo files through the protocol
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'unpixel-mcp-'))
const mcp = new Client({ name: 'selftest', version: '1.0.0' })
await mcp.connect(new StdioClientTransport({ command: process.execPath, args: ['mcp/server.mjs'] }))
try {
  const { tools } = await mcp.listTools()
  assert.deepEqual(tools.map((t) => t.name), ['optimize_images', 'compress_video'])
  assert.deepEqual(tools.map((t) => t.inputSchema.required), [['paths'], ['path']], 'only the files are required')
  const said = (r) => r.content[0].text
  const run = (name, args) => mcp.callTool({ name, arguments: args }, undefined, { timeout: 120000 })

  const webp = path.join(tmp, 'studio.webp')
  const images = await run('optimize_images', { paths: ['public/demo/studio.jpg', 'package.json'], output_dir: tmp })
  assert.ok(!images.isError && said(images).includes(webp) && said(images).includes('package.json : échec'), 'a bad file does not stop the others')
  assert.equal(fs.readFileSync(webp).subarray(8, 12).toString(), 'WEBP')
  assert.ok(fs.statSync(webp).size < fs.statSync('public/demo/studio.jpg').size, 'lighter than the original')
  await run('optimize_images', { paths: ['public/demo/studio.jpg'], output_dir: tmp })
  assert.ok(fs.existsSync(path.join(tmp, 'studio-2.webp')), 'a second run never overwrites the first')
  assert.ok((await run('optimize_images', { paths: ['package.json'] })).isError, 'nothing worked: an error')

  const mp4 = path.join(tmp, 'bmg_paint-720.mp4')
  const video = await run('compress_video', { path: 'public/demo/paint.mp4', preset: 'light', start: 1, end: 3, output_dir: tmp })
  assert.ok(!video.isError && said(video).includes(mp4), said(video))
  assert.deepEqual(sampleEntryCodes(fs.readFileSync(mp4)), ['avc1'], 'H.264 in an MP4')
  assert.ok(fs.statSync(mp4).size < fs.statSync('public/demo/paint.mp4').size)
  assert.ok((await run('compress_video', { path: 'package.json' })).isError)
  assert.ok((await run('compress_video', { path: 'public/demo/paint.mp4', start: 3, end: 1 })).isError)
  // A file list disguised as a video (it would pull in another file from the disk) is refused, and leaves nothing behind
  const fake = path.join(tmp, 'liste.mp4')
  fs.writeFileSync(fake, "ffconcat version 1.0\nfile 'bmg_paint-720.mp4'\n")
  assert.ok((await run('compress_video', { path: fake })).isError, 'disguised file list refused')
  assert.ok(!fs.existsSync(path.join(tmp, 'bmg_liste-1080.mp4')))
  assert.ok((await run('optimize_images', { paths: ['\\\\srv\\share\\a.jpg'] })).isError)
  if (process.platform === 'win32') {
    const share = await run('optimize_images', { paths: ['public/demo/studio.jpg'], output_dir: '\\\\srv\\share\\out' })
    assert.ok(share.isError && said(share).includes('chemins réseau'), 'never written to a network share')
  }
} finally {
  await mcp.close()
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log('selftest ok')
