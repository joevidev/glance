// Serve the MediaPipe wasm and the face model to the renderer from disk (no network at demo time).
// glance-asset://wasm/<file>  -> node_modules/@mediapipe/tasks-vision/wasm/<file>
// glance-asset://model/<file> -> apps/desktop/resources/<file>  (downloaded once, gitignored)
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, normalize } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { app, net, protocol } from 'electron'

export const SCHEME = 'glance-asset'
export const MODEL_FILE = 'face_landmarker.task'
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

export function registerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: true } },
  ])
}

const resourcesDir = () => join(app.getAppPath(), 'resources')
export const modelPath = () => join(resourcesDir(), MODEL_FILE)

function wasmDir(): string {
  const req = createRequire(join(app.getAppPath(), 'package.json'))
  return join(dirname(req.resolve('@mediapipe/tasks-vision')), 'wasm')
}

const MIME: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.js': 'text/javascript',
  '.task': 'application/octet-stream',
}

export function handleScheme(): void {
  protocol.handle(SCHEME, async (req) => {
    const u = new URL(req.url)
    const rel = normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '')
    const base = u.hostname === 'wasm' ? wasmDir() : u.hostname === 'model' ? resourcesDir() : null
    if (!base || rel.includes('..')) return new Response('not found', { status: 404 })
    const file = join(base, rel)
    if (!existsSync(file)) return new Response('not found', { status: 404 })
    const ext = file.slice(file.lastIndexOf('.'))
    const res = await net.fetch('file://' + file)
    const headers = new Headers(res.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    headers.set('Content-Type', MIME[ext] ?? 'application/octet-stream')
    return new Response(res.body, { status: 200, headers })
  })
}

let state: { ready: boolean; error?: string } = { ready: false }
export const assetState = () => state

/** Download the face model once. Resolves when it is on disk. */
export async function ensureModel(): Promise<void> {
  const p = modelPath()
  if (existsSync(p) && statSync(p).size > 1_000_000) {
    state = { ready: true }
    return
  }
  try {
    mkdirSync(resourcesDir(), { recursive: true })
    const res = await net.fetch(MODEL_URL)
    if (!res.ok || !res.body) throw new Error(`model download failed: HTTP ${res.status}`)
    const tmp = p + '.part'
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp))
    renameSync(tmp, p)
    state = { ready: true }
  } catch (e) {
    state = { ready: false, error: e instanceof Error ? e.message : String(e) }
  }
}
