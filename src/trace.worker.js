import { potrace, init } from 'esm-potrace-wasm'
import { colorLayers, assembleSvg, edgeCount, MAX_EDGES, workParams } from './trace.js'

const ready = init()

self.onmessage = async ({ data: { id, imgd, opts } }) => {
  try {
    await ready
    const { width: w, height: h } = imgd
    const scale = w / opts.outW // work pixels per source pixel
    const { smooth, potrace: params } = workParams(opts, scale)
    const layers = colorLayers(imgd, { ...opts, smooth })
    // Build every mask first and check complexity: potrace on a photo would run for minutes and output megabytes.
    let edges = 0
    for (const l of layers) {
      l.data = l.mask()
      edges += edgeCount(l.data, w) / scale
      if (edges > MAX_EDGES) return self.postMessage({ id, tooComplex: true })
    }
    for (const l of layers) l.svg = await potrace(new ImageData(l.data, w, h), params)
    self.postMessage({ id, edges: Math.round(edges), ...assembleSvg(layers, w, h, opts.outW, opts.outH) })
  } catch (e) {
    self.postMessage({ id, error: String(e?.message || e) })
  }
}
