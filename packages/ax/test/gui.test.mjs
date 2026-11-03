// Needs a real desktop and Accessibility permission: only runs with GLANCE_AX_GUI=1.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'glance-ax')
test('elements of the frontmost app', { skip: process.env.GLANCE_AX_GUI ? false : 'set GLANCE_AX_GUI=1 (needs Accessibility)' }, () => {
  const r = spawnSync(bin, ['elements'], { encoding: 'utf8' })
  const j = JSON.parse(r.stdout)
  if (!j.trusted) return assert.match(j.error, /Accessibility/)
  assert.ok(Array.isArray(j.elements))
  assert.ok(j.elements.length <= 80)
})
