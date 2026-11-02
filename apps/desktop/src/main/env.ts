// Load the repo-root .env into process.env, in the main process only. Never log values.
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { app } from 'electron'
import { config } from 'dotenv'

export function repoRoot(): string {
  let dir = resolve(app.getAppPath())
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    dir = dirname(dir)
  }
  return resolve(app.getAppPath(), '../..')
}

export function loadEnv(): void {
  config({ path: join(repoRoot(), '.env'), quiet: true, override: false })
}
