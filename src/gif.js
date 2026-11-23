// Video to GIF, light for its quality: one palette for the whole GIF, and each frame only stores the pixels that
// visibly changed (the others are transparent and show the previous frame through).
import * as lib from 'gifenc'
const { GIFEncoder, quantize, applyPalette } = lib.quantize ? lib : lib.default // ESM build in the browser, CommonJS one in Node (tests, MCP)

// size: longest side in pixels. threshold: a colour change smaller than this (0-255 per channel) is treated as noise.
// dither: strength of the ordered dithering. Measured on the demo clip: 256 colours + light dithering removes the
// banding of 128 colours for about the same weight; stronger dithering shows a visible dot pattern.
export const GIF_PRESETS = [
  { id: 'light', label: 'Léger', desc: '320 px, 10 images/s : pour les messageries', size: 320, fps: 10, colors: 128, threshold: 6, dither: 8 },
  { id: 'standard', label: 'Standard', desc: '480 px, 12 images/s : bon compromis', size: 480, fps: 12, colors: 256, threshold: 4, dither: 8 },
  { id: 'high', label: 'Haute qualité', desc: '640 px, 15 images/s, fichier plus lourd', size: 640, fps: 15, colors: 256, threshold: 2, dither: 6 },
]

export const MAX_GIF_SECONDS = 30 // a GIF is for a few seconds; longer ones get huge and slow to make

export function gifSize(w, h, size) {
  const k = Math.min(1, size / Math.max(w, h)) // never upscaled
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) }
}

// Frame times from start to end at the preset's rate. GIF delays are in hundredths of a second.
export function gifTimes(start, end, fps) {
  const n = Math.max(1, Math.round((end - start) * fps))
  return Array.from({ length: n }, (_, i) => start + i / fps)
}

// One palette for all frames, from a few frames spread over the clip (colors - 1: the last slot is the transparent one)
export function gifPalette(samples, colors) {
  const all = new Uint8ClampedArray(samples.reduce((n, s) => n + s.length, 0))
  let o = 0
  for (const s of samples) all.set(s, o), (o += s.length)
  return quantize(all, colors - 1)
}

// 4×4 Bayer matrix: ordered dithering rebuilds the shades between palette colours with a fixed pattern of dots.
// Fixed by pixel position, so a still area gives the same dots every frame: no shimmer, and it stays transparent.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5)

export function dither(rgba, width, spread) {
  if (!spread) return rgba
  const out = new Uint8ClampedArray(rgba.length)
  for (let p = 0, q = 0; q < rgba.length; p++, q += 4) {
    const t = BAYER[((Math.floor(p / width) & 3) << 2) | (p % width & 3)] * spread
    out[q] = rgba[q] + t
    out[q + 1] = rgba[q + 1] + t
    out[q + 2] = rgba[q + 2] + t
    out[q + 3] = 255
  }
  return out
}

export function createGif(palette, width, height, preset) {
  const enc = GIFEncoder()
  const transparent = palette.length // never returned by applyPalette, which only knows the real colours
  const table = [...palette, [0, 0, 0]]
  const written = new Uint8ClampedArray(width * height * 3) // the source colour each pixel had when last written
  const delay = Math.round(100 / preset.fps) * 10
  let first = true
  let changed = 0
  return {
    add(rgba) {
      const index = applyPalette(dither(rgba, width, preset.dither), palette)
      for (let p = 0, q = 0; p < index.length; p++, q += 4) {
        const s = p * 3
        // Compared with the video itself, not with the palette colour: quantization error never counts as a change
        if (
          !first &&
          Math.abs(rgba[q] - written[s]) <= preset.threshold &&
          Math.abs(rgba[q + 1] - written[s + 1]) <= preset.threshold &&
          Math.abs(rgba[q + 2] - written[s + 2]) <= preset.threshold
        ) {
          index[p] = transparent // no visible change: the previous frame shows through
          continue
        }
        written[s] = rgba[q]
        written[s + 1] = rgba[q + 1]
        written[s + 2] = rgba[q + 2]
        changed++
      }
      // dispose 1 (keep the frame): transparent pixels must show the previous frame, not the background
      enc.writeFrame(index, width, height, { palette: first ? table : undefined, transparent: !first, transparentIndex: transparent, delay, dispose: 1, repeat: 0 })
      first = false
    },
    finish() {
      enc.finish()
      return { bytes: enc.bytes(), changed }
    },
  }
}
