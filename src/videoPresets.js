// Same recipes as BOOMERANG LightVid (ffmpeg: libx264 -crf -maxrate, AAC stereo, +faststart),
// encoded here with the browser's WebCodecs encoder instead of ffmpeg.
export const PRESETS = [
  { id: 'light', label: 'Léger (720p)', desc: 'Fichier léger, chargement rapide', suffix: '-720', height: 720, crf: 28, maxrate: 1e6, audio: 96e3 },
  { id: 'standard', label: 'Standard (1080p)', desc: 'Bon compromis qualité / poids', suffix: '-1080', height: 1080, crf: 26, maxrate: 2e6, audio: 128e3 },
  { id: 'high', label: 'Haute qualité', desc: 'Qualité maximale, fichier plus volumineux', suffix: '-high', height: null, crf: 22, maxrate: 5e6, audio: 128e3 },
]

export const VIDEO_EXT = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'flv', 'wmv']

// LightVid names its output bmg_{stem}{suffix}.mp4
export const outputName = (fileName, preset) => `bmg_${fileName.replace(/\.[^.]+$/, '') || 'video'}${preset.suffix}.mp4`

// Like ffmpeg scale=-2:H (height fixed, width from the aspect ratio), but never upscales. H.264 needs even sizes.
export function targetSize(w, h, maxH) {
  const th = maxH && h > maxH ? maxH : h
  const even = (v) => Math.max(2, Math.round(v / 2) * 2)
  return { width: even((w * th) / h), height: even(th) }
}

export const isVideoFile = (file) =>
  !!file && (file.type.startsWith('video/') || VIDEO_EXT.includes(file.name.split('.').pop().toLowerCase()))

// Cut points: 0 ≤ start < end ≤ duration, at least MIN_CLIP apart. `edge` is the one being moved.
export const MIN_CLIP = 0.5
export function clampTrim({ start, end }, duration, edge) {
  const gap = Math.min(MIN_CLIP, duration)
  if (edge === 'start') start = Math.min(Math.max(0, start), end - gap)
  else end = Math.max(Math.min(duration, end), start + gap)
  return { start: Math.max(0, start), end: Math.min(duration, end) }
}

// 75.04 → "01:15.0" (tenths, rounded once so 59.96 gives "01:00.0", not "00:60.0")
export function fmtTime(t) {
  const d = Math.round(Math.max(0, t) * 10)
  return `${String(Math.floor(d / 600)).padStart(2, '0')}:${((d % 600) / 10).toFixed(1).padStart(4, '0')}`
}

// LightVid caps the video bitrate with -maxrate; true when a quantizer-based encode went over that cap.
export const overCap = (bytes, seconds, preset, muted) =>
  seconds > 0 && (bytes * 8) / seconds - (muted ? 0 : preset.audio) > preset.maxrate * 1.15
