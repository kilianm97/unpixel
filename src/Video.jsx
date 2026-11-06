import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Input, BlobSource, ALL_FORMATS, Output, Mp4OutputFormat, BufferTarget, Conversion, Quality, CanvasSink,
  canEncodeAudio, ConversionCanceledError, UnsupportedInputFormatError,
} from 'mediabunny'
import { PRESETS, outputName, targetSize, overCap, clampTrim, fmtTime, sampleEntryCodes, unreadableVideoMessage } from './videoPresets.js'

const spring = { type: 'spring', stiffness: 260, damping: 30 }
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const fmtBytes = (b) =>
  b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} Ko` : b < 1024 ** 3 ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} Mo` : `${(b / 1024 ** 3).toFixed(2).replace('.', ',')} Go`
const THUMBS = 12

function readable(e) {
  if (e instanceof UnsupportedInputFormatError) return 'Ce format n’est pas lisible par le navigateur. Utilisez un fichier MP4, MOV, MKV ou WebM.'
  return e?.message || String(e)
}

// Names the real codec (ProRes, HEVC…) from the file header; MOV files often keep it at the end.
async function codecHelp(file) {
  const n = 4 * 1024 * 1024
  const part = async (a, b) => new Uint8Array(await file.slice(a, b).arrayBuffer())
  const codes = sampleEntryCodes(await part(0, n))
  if (file.size > n) codes.push(...sampleEntryCodes(await part(file.size - n, file.size)))
  return unreadableVideoMessage(codes)
}

function discardMessage(discarded) {
  const video = discarded.find((d) => d.track.isVideoTrack())
  if (!video) return null
  if (video.reason === 'undecodable_source_codec') return unreadableVideoMessage([])
  if (video.reason === 'no_encodable_target_codec') return 'Votre navigateur ne sait pas encoder en H.264. Essayez avec Chrome ou Edge à jour.'
  return 'Cette vidéo ne peut pas être convertie.'
}

// One LightVid-style encode: quantizer (≈ CRF) first; if the result breaks the preset's -maxrate, a second pass at that bitrate.
async function compress(file, preset, { trim, duration, mute, onProgress, onConversion }) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    const { width, height } = targetSize(track.displayWidth, track.displayHeight, preset.height)
    const audioCodec = (await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000 })) ? 'aac' : 'opus'
    const full = trim.start <= 0 && trim.end >= duration
    let audioLost = false

    const run = async (quality, phase) => {
      const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
      const conversion = await Conversion.init({
        input,
        output,
        tracks: 'primary',
        trim: full ? undefined : { start: trim.start, end: trim.end },
        video: { codec: 'avc', width, height, fit: 'fill', quality, forceTranscode: true },
        audio: mute ? { discard: true } : { codec: audioCodec, numberOfChannels: 2, quality: new Quality({ bitrate: preset.audio }), forceTranscode: true },
      })
      const blocking = discardMessage(conversion.discardedTracks)
      if (blocking || !conversion.isValid) throw new Error(blocking ?? 'Cette vidéo ne peut pas être convertie.')
      audioLost = !mute && conversion.discardedTracks.some((d) => d.track.isAudioTrack())
      conversion.onProgress = (p) => onProgress(phase, p)
      onConversion(conversion)
      await conversion.execute()
      return new Blob([output.target.buffer], { type: 'video/mp4' })
    }

    let blob = await run(new Quality({ quantizer: preset.crf, bitrate: preset.maxrate, bitrateMode: 'variable' }), 'encode')
    if (overCap(blob.size, trim.end - trim.start, preset, mute || audioLost))
      blob = await run(new Quality({ bitrate: preset.maxrate, bitrateMode: 'variable' }), 'cap')
    return { blob, width, height, audioCodec: mute || audioLost ? null : audioCodec, audioLost }
  } finally {
    input.dispose()
  }
}

export default function VideoTool({ video }) {
  const [info, setInfo] = useState(null)
  const [thumbs, setThumbs] = useState([])
  const [trim, setTrim] = useState(null)
  const [presetId, setPresetId] = useState('standard')
  const [mute, setMute] = useState(false)
  const [job, setJob] = useState(null)
  const [out, setOut] = useState(null)
  const [error, setError] = useState('')
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [showResult, setShowResult] = useState(false)
  const player = useRef(null)
  const conversion = useRef(null)
  const preset = PRESETS.find((p) => p.id === presetId)

  // Duration, size and filmstrip thumbnails
  useEffect(() => {
    let alive = true
    const input = new Input({ source: new BlobSource(video.file), formats: ALL_FORMATS })
    ;(async () => {
      try {
        const track = await input.getPrimaryVideoTrack()
        if (!track) throw new Error('Aucune piste vidéo dans ce fichier.')
        const duration = await input.computeDuration()
        if (!alive) return
        setInfo({ duration, width: track.displayWidth, height: track.displayHeight })
        setTrim({ start: 0, end: duration })
        if (!(await track.canDecode())) throw new Error(await codecHelp(video.file))
        const h = 72, w = Math.max(1, Math.round((h * track.displayWidth) / track.displayHeight))
        const sink = new CanvasSink(track, { width: w, height: h, fit: 'cover' })
        const list = []
        for await (const c of sink.canvasesAtTimestamps(Array.from({ length: THUMBS }, (_, i) => ((i + 0.5) * duration) / THUMBS))) {
          if (!alive) return
          list.push(c?.canvas ?? null)
          setThumbs([...list])
        }
      } catch (e) {
        if (alive) setError(readable(e))
      }
    })()
    return () => {
      alive = false
      input.dispose()
    }
  }, [video])

  // Smooth playhead + loop inside the selection while editing
  useEffect(() => {
    if (!playing) return
    let raf
    const tick = () => {
      const v = player.current
      if (v) {
        if (!showResult && trim && v.currentTime >= trim.end) v.currentTime = trim.start
        setTime(v.currentTime)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, trim, showResult])

  // Any setting change makes the last result stale
  useEffect(() => {
    setOut((o) => (o && URL.revokeObjectURL(o.url), null))
    setShowResult(false)
  }, [presetId, mute, trim])

  useEffect(() => () => conversion.current?.cancel(), [])
  useEffect(() => () => out && URL.revokeObjectURL(out.url), [out])

  function seek(t) {
    if (player.current) player.current.currentTime = t
    setTime(t)
  }
  function togglePlay() {
    const v = player.current
    if (!v) return
    if (v.paused) {
      if (!showResult && trim && (v.currentTime < trim.start || v.currentTime >= trim.end - 0.05)) v.currentTime = trim.start
      v.play()
    } else v.pause()
  }
  const setEdge = (edge) => trim && setTrim(clampTrim({ ...trim, [edge]: time }, info.duration, edge))

  // Editor shortcuts: space, I (in), O (out)
  useEffect(() => {
    const onKey = (e) => {
      if (job || e.target.closest('input, textarea, select, [role=slider]') || e.ctrlKey || e.metaKey) return
      if (e.key === ' ' && !e.target.closest('button')) (e.preventDefault(), togglePlay())
      else if (e.key.toLowerCase() === 'i') setEdge('start')
      else if (e.key.toLowerCase() === 'o') setEdge('end')
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  async function run() {
    setError('')
    player.current?.pause()
    setJob({ phase: 'encode', p: 0 })
    try {
      const r = await compress(video.file, preset, {
        trim,
        duration: info.duration,
        mute,
        onProgress: (phase, p) => setJob({ phase, p }),
        onConversion: (c) => (conversion.current = c),
      })
      setOut({ ...r, url: URL.createObjectURL(r.blob), bytes: r.blob.size })
      setShowResult(true)
      setTime(0)
    } catch (e) {
      if (!(e instanceof ConversionCanceledError)) setError(readable(e))
    } finally {
      conversion.current = null
      setJob(null)
    }
  }

  const clip = trim ? trim.end - trim.start : 0
  const cut = info && trim && (trim.start > 0 || trim.end < info.duration)
  const gain = out ? Math.round((1 - out.bytes / video.file.size) * 100) : null
  const outSize = info && targetSize(info.width, info.height, preset.height)

  return (
    <motion.main key="video" className="work" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
      <section className="editor" aria-label="Montage">
        <div className="screen">
          <video
            ref={player}
            key={showResult ? 'out' : 'src'}
            src={showResult ? out.url : video.url}
            playsInline
            preload="auto"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onSeeked={(e) => setTime(e.currentTarget.currentTime)}
            onClick={togglePlay}
          />
          <span className="tag tag-r">{showResult ? 'Résultat' : 'Original'}</span>
        </div>

        <div className="transport">
          <motion.button className="play" onClick={togglePlay} whileTap={{ scale: 0.92 }} aria-label={playing ? 'Pause' : 'Lecture'} disabled={!info}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              {playing ? <path d="M7 5h3v14H7zM14 5h3v14h-3z" /> : <path d="M8 5l11 7-11 7z" />}
            </svg>
          </motion.button>
          <span className="clock">
            {fmtTime(time)} <span>/ {fmtTime(showResult ? clip : info?.duration ?? 0)}</span>
          </span>
          {!showResult && (
            <span className="transport-cut">
              <button className="ghost" onClick={() => setEdge('start')} disabled={!info} title="Raccourci : I">
                Début ici
              </button>
              <button className="ghost" onClick={() => setEdge('end')} disabled={!info} title="Raccourci : O">
                Fin ici
              </button>
            </span>
          )}
        </div>

        {info && trim && !showResult && <Timeline duration={info.duration} trim={trim} setTrim={setTrim} time={time} onSeek={seek} thumbs={thumbs} />}
        {info && trim && !showResult && (
          <p className="cut-info">
            {cut ? (
              <>
                Coupe de <strong>{fmtTime(trim.start)}</strong> à <strong>{fmtTime(trim.end)}</strong>, durée gardée {fmtTime(clip)}.{' '}
                <button className="link" onClick={() => setTrim({ start: 0, end: info.duration })}>
                  Garder toute la vidéo
                </button>
              </>
            ) : (
              'Faites glisser les poignées pour couper le début ou la fin. Raccourcis : Espace, I et O.'
            )}
          </p>
        )}
      </section>

      <aside className="panel">
        <div>
          <h2 className="file" title={video.name}>{video.name}</h2>
          <div className="gain" aria-live="polite">
            {gain !== null ? (
              <>
                <strong data-worse={gain <= 0}>{gain > 0 ? `−${gain} %` : fmtBytes(out.bytes)}</strong>
                <span>{gain > 0 ? `${fmtBytes(video.file.size)} → ${fmtBytes(out.bytes)}` : `au lieu de ${fmtBytes(video.file.size)}`}</span>
              </>
            ) : (
              <span className="gain-wait">
                {fmtBytes(video.file.size)}
                {info && <>, {info.width} × {info.height}, {fmtTime(info.duration)}</>}
              </span>
            )}
          </div>
          {gain !== null && gain <= 0 && (
            <p className="hint gain-why">
              {presetId === 'light'
                ? 'Cette vidéo est déjà très compressée : la garder telle quelle reste le meilleur choix.'
                : 'Cette vidéo est déjà très compressée : essayez le préréglage Léger.'}
            </p>
          )}
        </div>

        <div className="field" role="radiogroup" aria-label="Préréglage">
          <span className="field-label">Préréglage</span>
          {PRESETS.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={p.id === presetId} className="preset" onClick={() => setPresetId(p.id)} disabled={!!job}>
              {p.id === presetId && <motion.span layoutId="preset-pill" className="preset-pill" transition={spring} />}
              <span className="preset-text">
                <strong>{p.label}</strong>
                <span>{p.desc}</span>
              </span>
            </button>
          ))}
          {outSize && <span className="hint">Sortie MP4 en {outSize.width} × {outSize.height}, H.264{mute ? ', sans son' : ' + AAC'}.</span>}
        </div>

        <label className="switch">
          <input type="checkbox" checked={mute} onChange={(e) => setMute(e.target.checked)} disabled={!!job} />
          <span className="track"><motion.span className="thumb" layout transition={spring} /></span>
          Supprimer le son
        </label>

        {error && <p className="error" role="alert">{error}</p>}
        {out?.audioLost && <p className="hint">Le son de cette vidéo n’a pas pu être conservé par le navigateur.</p>}

        <div className="actions">
          <AnimatePresence mode="wait" initial={false}>
            {job ? (
              <motion.div key="job" className="job" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.p * 100)}>
                  <motion.span style={{ width: `${job.p * 100}%` }} transition={reduced() ? { duration: 0 } : undefined} />
                </div>
                <span className="hint">
                  {job.phase === 'cap' ? 'Ajustement du débit' : 'Compression'} : {Math.round(job.p * 100)} %
                </span>
                <button className="secondary" onClick={() => conversion.current?.cancel()}>
                  Annuler
                </button>
              </motion.div>
            ) : out ? (
              <motion.div key="done" className="job" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <motion.a className="primary" href={out.url} download={outputName(video.name, preset)} whileTap={{ scale: 0.97 }}>
                  Télécharger la vidéo
                </motion.a>
                <button className="secondary" onClick={() => (player.current?.pause(), setShowResult((s) => !s), setTime(0))}>
                  {showResult ? 'Revenir au montage' : 'Voir le résultat'}
                </button>
              </motion.div>
            ) : (
              <motion.button key="go" className="primary" onClick={run} disabled={!info || !!error} whileTap={{ scale: 0.97 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                Compresser la vidéo
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </aside>
    </motion.main>
  )
}

function Timeline({ duration, trim, setTrim, time, onSeek, thumbs }) {
  const bar = useRef(null)
  const drag = useRef(null)
  const at = (e) => {
    const b = bar.current.getBoundingClientRect()
    return Math.min(duration, Math.max(0, ((e.clientX - b.left) / b.width) * duration))
  }
  const down = (what) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    bar.current.setPointerCapture(e.pointerId)
    drag.current = what
    if (what === 'seek') onSeek(at(e))
  }
  const move = (e) => {
    const what = drag.current
    if (!what) return
    const t = at(e)
    if (what === 'seek') return onSeek(t)
    const next = clampTrim({ ...trim, [what]: t }, duration, what)
    setTrim(next)
    onSeek(next[what])
  }
  const key = (edge) => (e) => {
    const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key]
    if (!d) return
    e.preventDefault()
    const next = clampTrim({ ...trim, [edge]: trim[edge] + d * (e.shiftKey ? 1 : 0.1) }, duration, edge)
    setTrim(next)
    onSeek(next[edge])
  }
  const pct = (t) => `${(t / duration) * 100}%`
  const handle = (edge, label) => (
    <span
      className={`tl-handle ${edge}`}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration * 10) / 10}
      aria-valuenow={Math.round(trim[edge] * 10) / 10}
      aria-valuetext={fmtTime(trim[edge])}
      onPointerDown={down(edge)}
      onKeyDown={key(edge)}
    />
  )

  return (
    <div className="timeline">
      <div ref={bar} className="tl-track" onPointerDown={down('seek')} onPointerMove={move} onPointerUp={() => (drag.current = null)} onPointerCancel={() => (drag.current = null)}>
        <div className="tl-thumbs" aria-hidden="true">
          {Array.from({ length: THUMBS }, (_, i) =>
            thumbs[i] ? (
              <canvas key={i} width={thumbs[i].width} height={thumbs[i].height} ref={(el) => el?.getContext('2d').drawImage(thumbs[i], 0, 0)} />
            ) : (
              <span key={i} className="tl-thumb-wait" />
            ),
          )}
        </div>
        <div className="tl-shade left" style={{ left: 0, width: pct(trim.start) }} />
        <div className="tl-shade right" style={{ left: pct(trim.end), right: 0 }} />
        <div className="tl-sel" style={{ left: pct(trim.start), width: pct(trim.end - trim.start) }}>
          {handle('start', 'Début de la coupe')}
          {handle('end', 'Fin de la coupe')}
        </div>
        <div className="tl-head" style={{ left: pct(time) }} aria-hidden="true" />
      </div>
    </div>
  )
}
