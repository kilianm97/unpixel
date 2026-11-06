// Run with `npm test`. Checks the color/mask logic (potrace itself runs in the browser worker).
import assert from 'node:assert/strict'
import { seedPalette, labelPixels, dropBackground, mask, colorLayers, assembleSvg, edgeCount, workParams, recolorSvg } from '../src/trace.js'
import { dragRect, spanRect, cropPixels, isFull, FULL, MIN } from '../src/crop.js'
import { psnr, findQuality } from '../src/compress.js'
import { parseConsent, serializeConsent, consentMode, wantsGtm, isGtmId, isTrackingCookie, cookieDomains } from '../src/consent.js'
import { PRESETS, outputName, targetSize, overCap, clampTrim, fmtTime, isVideoFile, sampleEntryCodes, unreadableVideoMessage } from '../src/videoPresets.js'

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

console.log('selftest ok')
