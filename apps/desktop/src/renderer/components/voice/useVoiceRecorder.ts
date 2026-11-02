// Push to talk in the renderer: permission, MediaRecorder, level meter, limits, one upload. Toggle with
// Option+Space (main sends 'ptt:toggle'), the radial menu mic, or the button.
import { useCallback, useEffect, useRef, useState } from 'react'
import { VOICE_LIMITS, type VoiceClientCode } from '../../../shared/voice'
import { useEvent } from '../../lib/hooks'
import { CLIENT_MESSAGES, judgeClip, rms } from './clip'

export type VoicePhase = 'idle' | 'starting' | 'listening' | 'transcribing'

export interface VoiceUi {
  phase: VoicePhase
  recording: boolean
  /** The last thing worth showing: the transcript in quotes, or why nothing happened. */
  heard: string | null
  /** true when `heard` is a failure. */
  problem: VoiceClientCode | 'speech' | null
  mic: string
  elapsedMs: number
  toggle: () => void
}

interface Active {
  mr: MediaRecorder
  chunks: Blob[]
  stream: MediaStream
  ctx: AudioContext | null
  meter: number | null
  startedAt: number
  peak: number
  metered: boolean
  stopAt: number
  limit: number
}

export function useVoiceRecorder(): VoiceUi {
  const [phase, setPhase] = useState<VoicePhase>('idle')
  const [heard, setHeard] = useState<string | null>(null)
  const [problem, setProblem] = useState<VoiceUi['problem']>(null)
  const [mic, setMic] = useState('unknown')
  const [elapsedMs, setElapsed] = useState(0)
  const active = useRef<Active | null>(null)
  const busy = useRef(false) // starting or transcribing: ignore toggles
  const lastToggle = useRef(0)

  useEffect(() => {
    if (phase !== 'listening') return
    const t = setInterval(() => active.current && setElapsed(Date.now() - active.current.startedAt), 100)
    return () => clearInterval(t)
  }, [phase])

  const fail = useCallback((code: VoiceClientCode, detail?: string) => {
    setProblem(code)
    setHeard(CLIENT_MESSAGES[code])
    window.glance.send('voice:client-error', { code, detail })
  }, [])

  const stop = useCallback(() => {
    const a = active.current
    if (!a || a.mr.state !== 'recording') return
    a.stopAt = Date.now()
    a.mr.stop()
  }, [])

  const start = useCallback(async () => {
    busy.current = true
    setPhase('starting')
    setProblem(null)
    try {
      const p = await window.glance.invoke('perm:media', { kind: 'microphone' }) // asks the OS once, then reports the status
      setMic(p)
      if (p !== 'granted') {
        fail('mic-denied', p)
        setPhase('idle')
        busy.current = false
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
      const mr = new MediaRecorder(stream, { mimeType })
      const a: Active = { mr, chunks: [], stream, ctx: null, meter: null, startedAt: Date.now(), peak: 0, metered: false, stopAt: 0, limit: 0 }
      // level meter: silence is caught here, before any upload
      try {
        const ctx = new AudioContext()
        await ctx.resume()
        if (ctx.state === 'running') {
          const an = ctx.createAnalyser()
          an.fftSize = 1024
          ctx.createMediaStreamSource(stream).connect(an)
          const buf = new Float32Array(an.fftSize)
          a.ctx = ctx
          a.metered = true
          a.meter = window.setInterval(() => {
            an.getFloatTimeDomainData(buf)
            a.peak = Math.max(a.peak, rms(buf))
          }, 50)
        } else void ctx.close()
      } catch {
        a.metered = false
      }
      mr.ondataavailable = (e) => e.data.size && a.chunks.push(e.data)
      mr.onstop = async () => {
        clearTimeout(a.limit)
        if (a.meter !== null) clearInterval(a.meter)
        void a.ctx?.close()
        stream.getTracks().forEach((t) => t.stop())
        active.current = null
        window.glance.send('ptt:state', { recording: false })
        const stopAt = a.stopAt || Date.now()
        const durationMs = stopAt - a.startedAt
        const blob = new Blob(a.chunks, { type: mr.mimeType })
        const why = judgeClip({ durationMs, bytes: blob.size, peak: a.metered ? a.peak : null })
        if (why) {
          fail(why, `${durationMs} ms, ${blob.size} bytes, peak ${a.peak.toFixed(4)}`)
          setPhase('idle')
          busy.current = false
          return
        }
        setPhase('transcribing')
        setHeard('Transcribing…')
        try {
          const r = await window.glance.invoke('speech:transcribe', { audio: await blob.arrayBuffer(), mime: mr.mimeType, durationMs, stopAt })
          if (r.text) {
            setProblem(null)
            setHeard(`“${r.text}”`)
          } else {
            setProblem('speech')
            setHeard(r.error ?? 'Did not catch that')
          }
        } catch (e) {
          setProblem('speech')
          setHeard('Speech failed: ' + (e instanceof Error ? e.message.slice(0, 100) : 'unknown error'))
        }
        setPhase('idle')
        busy.current = false
      }
      active.current = a
      mr.start(250)
      setHeard(null)
      setElapsed(0)
      setPhase('listening')
      window.glance.send('ptt:state', { recording: true })
      a.limit = window.setTimeout(() => active.current === a && stop(), VOICE_LIMITS.maxDurationMs)
      busy.current = false
    } catch (e) {
      const name = e instanceof Error ? e.name : ''
      fail(name === 'NotAllowedError' ? 'mic-denied' : 'mic-error', e instanceof Error ? `${name}: ${e.message}`.slice(0, 120) : undefined)
      setPhase('idle')
      busy.current = false
    }
  }, [fail, stop])

  const toggle = useCallback(() => {
    const now = Date.now()
    if (now - lastToggle.current < VOICE_LIMITS.toggleDebounceMs) return // key repeat or a double tap
    lastToggle.current = now
    if (active.current) return stop()
    if (busy.current) return
    void start()
  }, [start, stop])

  useEvent('ptt:toggle', toggle)
  useEffect(() => () => active.current?.stream.getTracks().forEach((t) => t.stop()), [])

  return { phase, recording: phase === 'listening', heard, problem, mic, elapsedMs, toggle }
}
