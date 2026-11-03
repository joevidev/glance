// Compile the Swift CLI with swiftc. Skips (exit 0) on non-macOS or when swiftc is missing, so Turbo stays green elsewhere.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
if (process.platform !== 'darwin') {
  console.log('glance-ax: not macOS, skipping build')
  process.exit(0)
}
const sources = readdirSync(join(root, 'src')).filter((f) => f.endsWith('.swift')).map((f) => join(root, 'src', f))
const out = join(root, 'bin', 'glance-ax')
mkdirSync(join(root, 'bin'), { recursive: true })
if (existsSync(out) && sources.every((s) => statSync(s).mtimeMs < statSync(out).mtimeMs)) {
  console.log('glance-ax: up to date')
  process.exit(0)
}
const r = spawnSync('swiftc', ['-O', '-o', out, ...sources], { stdio: 'inherit' })
if (r.error) {
  console.log('glance-ax: swiftc not available, skipping build (' + r.error.message + ')')
  process.exit(0)
}
if ((r.status ?? 1) !== 0) {
  // never take the whole turbo graph down for the optional desktop AX helper; GLANCE_AX_STRICT=1 makes it fatal
  console.error('glance-ax: swiftc FAILED (the desktop app falls back to the DOM extractor only)')
  process.exit(process.env.GLANCE_AX_STRICT ? 1 : 0)
}
process.exit(0)
