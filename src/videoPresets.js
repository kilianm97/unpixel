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

// Codec of an MP4/MOV, from the 4-letter code of its first video sample entry ("stsd" box).
// Used to explain *why* the browser can't read a file, instead of guessing.
export function sampleEntryCodes(bytes) {
  const codes = []
  const tag = [0x73, 0x74, 0x73, 0x64] // "stsd"
  for (let i = 0; i + 20 <= bytes.length; i++) {
    if (bytes[i] !== tag[0] || bytes[i + 1] !== tag[1] || bytes[i + 2] !== tag[2] || bytes[i + 3] !== tag[3]) continue
    // stsd: type(4) version/flags(4) count(4) entry size(4) entry type(4)
    codes.push(String.fromCharCode(...bytes.subarray(i + 16, i + 20)))
  }
  return codes
}

const CODEC_HELP = [
  [/^ap(4h|4x|ch|cn|cs|co)$/, 'Cette vidéo est en Apple ProRes, un format de montage qu’aucun navigateur ne sait lire. Exportez-la en H.264 (MP4) depuis votre logiciel de montage, puis déposez ce fichier.'],
  [/^(hvc1|hev1)$/, 'Cette vidéo est en HEVC (H.265), que votre navigateur ne sait pas lire sur cet ordinateur. Essayez avec Chrome ou Edge à jour, ou exportez-la en H.264 (MP4).'],
  [/^(dvh1|dvhe)$/, 'Cette vidéo est en Dolby Vision, que votre navigateur ne sait pas lire. Exportez-la en H.264 (MP4).'],
]
export function unreadableVideoMessage(codes) {
  for (const code of codes) for (const [re, msg] of CODEC_HELP) if (re.test(code)) return msg
  return 'Votre navigateur ne sait pas lire le codec de cette vidéo. Exportez-la en H.264 (MP4), puis déposez ce fichier.'
}

// Social video formats: crop the frame to an aspect (width / height) before encoding.
export const FRAMES = [
  { id: 'original', label: 'Original' },
  { id: '9:16', label: 'Vertical 9:16', ratio: 9 / 16 },
  { id: '1:1', label: 'Carré 1:1', ratio: 1 },
]

// Largest even-sized area with that aspect; pos (0..1) slides it along the axis that has room to spare.
export function videoCrop(w, h, ratio, pos = 0.5) {
  if (!ratio) return null
  const even = (v) => Math.max(2, Math.floor(v / 2) * 2)
  const cw = w / h > ratio ? even(h * ratio) : even(w)
  const ch = w / h > ratio ? even(h) : even(w / ratio)
  const at = (room) => Math.round((room * pos) / 2) * 2 // even offsets too: H.264 stores colour per 2×2 block
  return { left: at(w - cw), top: at(h - ch), width: cw, height: ch }
}

// LightVid caps the video bitrate with -maxrate; true when a quantizer-based encode went over that cap.
export const overCap = (bytes, seconds, preset, muted) =>
  seconds > 0 && (bytes * 8) / seconds - (muted ? 0 : preset.audio) > preset.maxrate * 1.15
