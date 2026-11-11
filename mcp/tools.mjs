// What the unpixel MCP server does to files on disk. Same settings as the site (compress.js, videoPresets.js):
// sharp and ffmpeg do here what the browser's canvas and WebCodecs do there.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import ffmpegPath from 'ffmpeg-static'
import { findQuality } from '../src/compress.js'
import { PRESETS, VIDEO_EXT, outputName } from '../src/videoPresets.js'
import { fmt } from '../src/imageExport.js'

export const IMAGE_FORMATS = { webp: 'webp', jpeg: 'jpg', png: 'png' } // format → file extension

// Never overwrite a file: photo.webp, then photo-2.webp, photo-3.webp…
export function freePath(dir, stem, ext, exists = existsSync) {
  for (let i = 1; ; i++) {
    const p = path.join(dir, `${stem}${i > 1 ? `-${i}` : ''}.${ext}`)
    if (!exists(p)) return p
  }
}

// A network share (\\server\share) would send files off this computer and can leak Windows credentials,
// and device paths (\\.\, \\?\) are not files: only local paths are accepted.
export const isRemotePath = (abs) => /^[\\/]{2}/.test(abs)
function local(p) {
  const abs = path.resolve(p)
  if (isRemotePath(abs)) throw new Error('les chemins réseau (\\\\serveur\\partage) ne sont pas acceptés, seulement les fichiers de cet ordinateur')
  return abs
}

export function gainText(before, after) {
  const gain = Math.round((1 - after / before) * 100)
  return `${fmt(before)} → ${fmt(after)} (${gain > 0 ? `−${gain} %` : 'plus lourd que l’original'})`
}

async function outputDir(src, output_dir) {
  const dir = output_dir ? local(output_dir) : path.dirname(src)
  await mkdir(dir, { recursive: true })
  return dir
}

// Optional resize, then the lightest quality with no visible difference (or the one asked for).
export async function optimizeImage(file, { format = 'webp', quality, width, output_dir } = {}) {
  const src = local(file)
  const before = (await stat(src)).size
  let img = sharp(src).rotate() // upright like in a browser (EXIF orientation)
  if (width) img = img.resize({ width, withoutEnlargement: true })
  if (format === 'jpeg') img = img.flatten({ background: '#fff' }) // JPG has no transparency
  const rgba = (s) => s.toColourspace('srgb').ensureAlpha().raw() // always 4 channels, what psnr() compares
  const { data: ref, info } = await rgba(img).toBuffer({ resolveWithObject: true })
  const pixels = () => sharp(ref, { raw: { width: info.width, height: info.height, channels: 4 } })
  const encode = (q) =>
    pixels()
      [format](format === 'png' ? { compressionLevel: 9 } : { quality: q, mozjpeg: true }) // mozjpeg: ignored by WebP
      .toBuffer()

  let out, q
  if (format === 'png') out = await encode() // lossless
  else if (quality) out = await encode((q = quality))
  else ({ blob: out, q } = await findQuality(encode, (buf) => rgba(sharp(buf)).toBuffer(), ref))

  const dest = freePath(await outputDir(src, output_dir), path.parse(src).name, IMAGE_FORMATS[format])
  await writeFile(dest, out, { flag: 'wx' }) // wx: fail rather than overwrite a file that appeared meanwhile
  return { output: dest, before, after: out.length, quality: q, width: info.width, height: info.height }
}

// The LightVid recipe (libx264 -crf -maxrate, AAC stereo, +faststart) that the site reproduces with WebCodecs.
export function ffmpegArgs(src, dest, preset, { start, end, mute } = {}) {
  const height = preset.height ? `min(${preset.height},ih)` : 'ih' // never upscaled
  return [
    '-hide_banner', '-loglevel', 'error', '-n', // -n: never overwrite
    // A playlist renamed .mp4 could make ffmpeg open other files or addresses: real video containers, local files only
    '-protocol_whitelist', 'file', '-format_whitelist', 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,flv,asf',
    ...(start != null ? ['-ss', String(start)] : []),
    ...(end != null ? ['-to', String(end)] : []),
    '-i', src,
    '-vf', `scale=-2:'trunc(${height}/2)*2'`, // H.264 needs even sizes
    '-c:v', 'libx264', '-crf', String(preset.crf), '-maxrate', String(preset.maxrate), '-bufsize', String(preset.maxrate * 2), '-pix_fmt', 'yuv420p',
    ...(mute ? ['-an'] : ['-c:a', 'aac', '-b:a', String(preset.audio), '-ac', '2']),
    '-sn', // subtitles of an MKV can't always go into an MP4
    '-movflags', '+faststart',
    dest,
  ]
}

// stdin and stdout stay closed: they carry the MCP protocol, ffmpeg must not read or write them.
const run = (cmd, args) =>
  new Promise((ok, fail) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    let err = ''
    p.stderr.on('data', (d) => (err = (err + d).slice(-1500)))
    p.on('error', fail)
    p.on('close', (code) => (code === 0 ? ok() : fail(new Error(err.trim() || `ffmpeg s’est arrêté (code ${code})`))))
  })

// shortcut: no progress notifications, a very long video can hit the MCP client's tool timeout; send ffmpeg -progress as notifications if that happens.
export async function compressVideo(file, { preset: id = 'standard', start, end, mute, output_dir } = {}) {
  const src = local(file)
  if (!VIDEO_EXT.includes(path.extname(src).slice(1).toLowerCase())) throw new Error(`ce n’est pas une vidéo (${VIDEO_EXT.join(', ')})`)
  if (start != null && end != null && end <= start) throw new Error('la fin de la coupe doit être après le début')
  if (!ffmpegPath) throw new Error('ffmpeg n’est pas disponible pour ce système')
  const before = (await stat(src)).size
  const preset = PRESETS.find((p) => p.id === id)
  const dest = freePath(await outputDir(src, output_dir), outputName(path.basename(src), preset).slice(0, -4), 'mp4')
  try {
    await run(ffmpegPath, ffmpegArgs(src, dest, preset, { start, end, mute }))
  } catch (e) {
    if (!/already exists/.test(e.message)) await rm(dest, { force: true }) // our own half-written file, never someone else's
    throw e
  }
  return { output: dest, before, after: (await stat(dest)).size }
}
