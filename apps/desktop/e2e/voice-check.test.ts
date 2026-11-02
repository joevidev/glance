// Live voice chain check WITHOUT a microphone: macOS `say` -> ffmpeg (opus in WebM, what Chromium MediaRecorder
// emits as audio/webm;codecs=opus) -> the SAME transcribeAudio() the app runs in the main process.
// Run:  GLANCE_VOICE_LIVE=1 pnpm --filter @glance/desktop exec vitest run e2e/voice-check.test.ts
// Costs a few cents (OpenAI gpt-4o-mini-transcribe). Synthetic voices are easier than a human voice.
// The key is loaded in-process from the repo-root .env and never printed.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeCommand } from '../src/main/features/voice/normalize'
import { transcribeAudio } from '../src/main/features/voice/transcribe'

const LIVE = process.env.GLANCE_VOICE_LIVE === '1'
const OUT = resolve(__dirname, 'out/voice')
const MIME = 'audio/webm;codecs=opus'
const UTTERANCES = ['open that', 'click the second link', 'reply yes tomorrow at three works', 'schedule it', 'scroll down', 'the invoice']
const VOICES = ['Samantha', 'Daniel', 'Flo (English (US))']
const NUM: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', second: '2nd', first: '1st', third: '3rd' }
const lenient = (s: string) => normalizeCommand(s).split(' ').map((w) => NUM[w] ?? w).join(' ')

function synth(voice: string | null, text: string | null, file: string, extra: string[] = []): Buffer {
  const aiff = file.replace(/\.webm$/, '.aiff')
  if (text !== null && voice) execFileSync('say', ['-v', voice, '-o', aiff, text])
  const src = text !== null ? ['-i', aiff] : extra
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...src, '-c:a', 'libopus', '-ar', '48000', '-ac', '1', '-b:a', '32k', file])
  return readFileSync(file)
}

interface Row { kind: string; voice: string; said: string; heard: string; command: string; ms: number; exact: boolean; lenientMatch: boolean; bytes: number; note: string }

describe.skipIf(!LIVE)('live voice chain (synthetic speech)', () => {
  it('transcribes synthetic utterances through the app function', { timeout: 300_000 }, async () => {
    const env = join(resolve(__dirname, '../../..'), '.env')
    if (existsSync(env)) process.loadEnvFile(env)
    expect(process.env.OPENAI_API_KEY, 'OPENAI_API_KEY').toBeTruthy()
    mkdirSync(OUT, { recursive: true })
    const rows: Row[] = []
    for (const voice of VOICES) {
      for (const said of UTTERANCES) {
        const f = join(OUT, `${voice.split(' ')[0]}-${said.replace(/\W+/g, '_')}.webm`)
        const audio = synth(voice, said, f)
        const r = await transcribeAudio(audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer, MIME)
        rows.push({ kind: 'speech', voice, said, heard: r.raw ?? '', command: r.text, ms: r.latencyMs ?? 0, exact: r.text === normalizeCommand(said), lenientMatch: lenient(r.text) === lenient(said), bytes: audio.length, note: r.error ?? '' })
      }
    }
    // negative cases: these must produce NO command (and in the app, no model call)
    for (const [name, args] of [
      ['silence 2s', ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '2']],
      ['room noise 2s', ['-f', 'lavfi', '-i', 'anoisesrc=d=2:c=pink:a=0.003:r=48000']],
      ['loud noise 2s', ['-f', 'lavfi', '-i', 'anoisesrc=d=2:c=white:a=0.05:r=48000']],
    ] as const) {
      const audio = synth(null, null, join(OUT, `${name.replace(/\W+/g, '_')}.webm`), [...args])
      const r = await transcribeAudio(audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer, MIME)
      rows.push({ kind: 'negative', voice: '-', said: name, heard: r.raw ?? '', command: r.text, ms: r.latencyMs ?? 0, exact: r.text === '', lenientMatch: r.text === '', bytes: audio.length, note: r.code ?? 'passed to intent!' })
    }
    writeFileSync(join(OUT, 'results.json'), JSON.stringify(rows, null, 2))
    const sp = rows.filter((r) => r.kind === 'speech')
    const lat = sp.map((r) => r.ms).sort((a, b) => a - b)
    const table = ['kind | voice | said | heard | exact | lenient | ms | bytes | note', ...rows.map((r) => [r.kind, r.voice, r.said, JSON.stringify(r.heard), r.exact, r.lenientMatch, r.ms, r.bytes, r.note].join(' | '))].join('\n')
    const summary = `\n${table}\n\nspeech: exact ${sp.filter((r) => r.exact).length}/${sp.length}, lenient ${sp.filter((r) => r.lenientMatch).length}/${sp.length}; latency ms median ${lat[lat.length >> 1]} min ${lat[0]} max ${lat[lat.length - 1]}\nnegatives passed through as a command: ${rows.filter((r) => r.kind === 'negative' && !r.exact).length}/${rows.length - sp.length}\n`
    writeFileSync(join(OUT, 'table.txt'), summary)
    process.stdout.write(summary)
  })
})

// App-level run through the REAL renderer (MediaRecorder, level meter, IPC) with Chromium's fake capture device:
//   pnpm --filter @glance/desktop exec electron-vite build --outDir .voice-out   (then move src/renderer/.voice-out/renderer to .voice-out/renderer,
//   add .voice-out/package.json {"main":"main/index.js"} and a resources symlink), then
//   GLANCE_SIM_CAMERA=1 GLANCE_VOICE_E2E=2400 electron .voice-out --no-sandbox --use-fake-device-for-media-stream \
//     --use-fake-ui-for-media-stream --use-file-for-fake-audio-capture=<wav>
// Prints "[voice-e2e] {...}" with the transcript, latency, gaze source and, for a silent clip, the pre-upload gate.
