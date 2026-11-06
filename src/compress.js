// "Optimal" compression: the lowest quality whose result is still visually identical to the original.
// Fidelity is measured with PSNR; 42 dB is above the point where people can tell the difference.
export const TARGET_DB = 42

// PSNR between two RGBA buffers of the same size. Pixels transparent in both are ignored.
export function psnr(a, b) {
  let se = 0, n = 0
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] === 0 && b[i + 3] === 0) continue
    for (let c = 0; c < 4; c++) {
      const d = a[i + c] - b[i + c]
      se += d * d
    }
    n += 4
  }
  return se === 0 ? Infinity : 10 * Math.log10((255 * 255) / (se / n))
}

// Binary search on integer qualities (lo..hi): encode(q) → blob, decode(blob) → RGBA pixels.
// Returns null when cancelled; falls back to the highest quality when nothing reaches the target.
export async function findQuality(encode, decode, ref, { target = TARGET_DB, lo = 30, hi = 95, cancelled = () => false } = {}) {
  let best = null
  const top = hi
  while (lo <= hi) {
    if (cancelled()) return null
    const q = (lo + hi) >> 1
    const blob = await encode(q)
    if (psnr(ref, await decode(blob)) >= target) {
      best = { blob, q }
      hi = q - 1
    } else lo = q + 1
  }
  return best ?? { blob: await encode(top), q: top }
}

/* ---------- browser side ---------- */

// Decoded RGBA pixels of an encoded image, to measure what the encoder really produced
export async function pixelsOf(blob, w, h) {
  const bmp = await createImageBitmap(blob)
  const ctx = new OffscreenCanvas(w, h).getContext('2d')
  ctx.drawImage(bmp, 0, 0)
  bmp.close()
  return ctx.getImageData(0, 0, w, h).data
}
