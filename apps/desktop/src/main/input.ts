// Client for the Rust native-input helper (packages/input): JSON lines over stdio.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot } from './env'
import type { InputStatus } from '../shared/ipc'

type Reply = { ok: boolean; error?: string; trusted?: boolean; x?: number; y?: number; [k: string]: unknown }

export class InputHelper {
  private proc: ChildProcessWithoutNullStreams | null = null
  private buf = ''
  private nextId = 1
  private waiting = new Map<number, (r: Reply) => void>()
  private moveInFlight = false
  private movePending: { x: number; y: number } | null = null
  trusted = false
  lastError: string | undefined
  onStatus?: (s: InputStatus) => void

  binPath(): string {
    // GLANCE_INPUT_BIN (tests only): stand-in helper, e.g. one that reports Accessibility as missing
    return process.env.GLANCE_INPUT_BIN || join(repoRoot(), 'packages/input/target/release/glance-input')
  }

  start(): void {
    if (this.proc) return
    const bin = this.binPath()
    if (!existsSync(bin)) {
      this.lastError = `native input helper not built (${bin}). Run: pnpm --filter @glance/input build`
      this.emit()
      return
    }
    const p = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.proc = p
    p.stdout.on('data', (d: Buffer) => {
      this.buf += d.toString('utf8')
      let i: number
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i)
        this.buf = this.buf.slice(i + 1)
        if (!line.trim()) continue
        try {
          const r = JSON.parse(line) as Reply & { id?: number }
          if (typeof r.trusted === 'boolean') this.setTrusted(r.trusted)
          const cb = r.id !== undefined ? this.waiting.get(r.id) : undefined
          if (cb && r.id !== undefined) {
            this.waiting.delete(r.id)
            cb(r)
          }
        } catch {
          /* ignore malformed line */
        }
      }
    })
    p.stderr.on('data', () => {})
    p.on('error', (e) => {
      this.lastError = e.message
      this.proc = null
      this.emit()
    })
    p.on('exit', () => {
      this.proc = null
      for (const [, cb] of this.waiting) cb({ ok: false, error: 'helper exited' })
      this.waiting.clear()
      this.moveInFlight = false
      // restart after a beat so a crash never leaves the app without input
      setTimeout(() => this.start(), 800)
    })
    void this.op({ op: 'trusted' })
  }

  private setTrusted(t: boolean): void {
    if (t !== this.trusted) {
      this.trusted = t
      this.emit()
    }
  }

  status(): InputStatus {
    return {
      running: !!this.proc,
      trusted: this.trusted,
      error: this.proc
        ? this.trusted
          ? undefined
          : 'Accessibility permission is missing: macOS ignores clicks and scrolls until you allow it (System Settings > Privacy & Security > Accessibility).'
        : this.lastError,
    }
  }

  private emit(): void {
    this.onStatus?.(this.status())
  }

  op(msg: Record<string, unknown>, timeoutMs = 1500): Promise<Reply> {
    const p = this.proc
    if (!p) return Promise.resolve({ ok: false, error: this.lastError ?? 'helper not running' })
    const id = this.nextId++
    return new Promise<Reply>((resolve) => {
      const t = setTimeout(() => {
        this.waiting.delete(id)
        resolve({ ok: false, error: 'timeout' })
      }, timeoutMs)
      this.waiting.set(id, (r) => {
        clearTimeout(t)
        resolve(r)
      })
      p.stdin.write(JSON.stringify({ ...msg, id }) + '\n', (err) => {
        if (err) {
          clearTimeout(t)
          this.waiting.delete(id)
          resolve({ ok: false, error: err.message })
        }
      })
    })
  }

  /** Coalescing move: never queues more than one pending move, so a slow helper cannot lag the cursor. */
  move(x: number, y: number): void {
    if (this.moveInFlight) {
      this.movePending = { x, y }
      return
    }
    this.moveInFlight = true
    void this.op({ op: 'move', x, y }).finally(() => {
      this.moveInFlight = false
      const n = this.movePending
      this.movePending = null
      if (n) this.move(n.x, n.y)
    })
  }

  moveAwait(x: number, y: number): Promise<Reply> {
    return this.op({ op: 'move', x, y })
  }
  /** second: only the second pair of a double click (clickState 2), after a first click already went out. */
  click(button: 'left' | 'right' = 'left', double = false, second = false): Promise<Reply> {
    return this.op({ op: 'click', button, double, second })
  }
  scroll(dy: number): Promise<Reply> {
    return this.op({ op: 'scroll', dy })
  }
  down(button: 'left' | 'right' = 'left'): Promise<Reply> {
    return this.op({ op: 'down', button })
  }
  up(button: 'left' | 'right' = 'left'): Promise<Reply> {
    return this.op({ op: 'up', button })
  }
  async pos(): Promise<{ x: number; y: number } | null> {
    const r = await this.op({ op: 'pos' })
    return r.ok && typeof r.x === 'number' && typeof r.y === 'number' ? { x: r.x, y: r.y } : null
  }

  stop(): void {
    const p = this.proc
    this.proc = null
    try {
      p?.stdin.end()
      p?.kill()
    } catch {
      /* ignore */
    }
  }
}
