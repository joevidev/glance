// Parsing / mapping tests: no window, no Accessibility permission. They drive `glance-ax normalize` with fixture nodes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'glance-ax')
const have = process.platform === 'darwin' && existsSync(bin)
const opts = { skip: have ? false : 'glance-ax binary not built (not macOS or no swiftc)' }

const node = (o) => ({ x: 100, y: 100, w: 80, h: 30, ...o })
function normalize(nodes, clip) {
  const r = spawnSync(bin, ['normalize'], { input: JSON.stringify({ nodes, clip }), encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

test('role mapping uses the extractor vocabulary', opts, () => {
  const out = normalize([
    node({ role: 'AXButton', title: 'Save', y: 10 }),
    node({ role: 'AXLink', title: 'Docs', y: 50 }),
    node({ role: 'AXTextField', description: 'Address', y: 90 }),
    node({ role: 'AXTextField', subrole: 'AXSearchField', description: 'Search', y: 130 }),
    node({ role: 'AXCheckBox', title: 'Remember', y: 170 }),
    node({ role: 'AXCheckBox', subrole: 'AXSwitch', title: 'Wi-Fi', y: 210 }),
    node({ role: 'AXRadioButton', subrole: 'AXTabButton', title: 'Inbox', y: 250 }),
    node({ role: 'AXMenuItem', title: 'Copy', y: 290 }),
    node({ role: 'AXPopUpButton', title: 'Sort', y: 330 }),
  ])
  assert.deepEqual(out.map((e) => e.role), ['button', 'link', 'textbox', 'searchbox', 'checkbox', 'switch', 'tab', 'menuitem', 'combobox'])
  assert.deepEqual(out.map((e) => e.id), [0, 1, 2, 3, 4, 5, 6, 7, 8])
})

test('names: cleaned, quotes replaced, 80 chars max, fallbacks in order', opts, () => {
  const out = normalize([
    node({ role: 'AXButton', title: '  Say   "hi"\n there ', y: 10 }),
    node({ role: 'AXButton', description: 'x'.repeat(200), y: 50 }),
    node({ role: 'AXTextField', placeholder: 'Search mail', y: 90 }),
    node({ role: 'AXButton', childText: 'From text child', y: 130 }),
    node({ role: 'AXButton', subrole: 'AXCloseButton', y: 170 }),
  ])
  assert.equal(out[0].name, "Say 'hi' there")
  assert.equal(out[1].name.length, 80)
  assert.equal(out[2].name, 'Search mail')
  assert.equal(out[3].name, 'From text child')
  assert.equal(out[4].name, 'close window')
})

test('drops unnamed, disabled, tiny, non-actionable and off-clip nodes', opts, () => {
  const out = normalize(
    [
      node({ role: 'AXButton', y: 10 }), // unnamed
      node({ role: 'AXButton', title: 'Off', enabled: false, y: 50 }),
      node({ role: 'AXButton', title: 'Tiny', w: 4, y: 90 }),
      node({ role: 'AXGroup', title: 'Group', y: 130 }), // not actionable
      node({ role: 'AXGroup', title: 'Pressable', hasPress: true, y: 170 }),
      node({ role: 'AXButton', title: 'Outside', y: 900 }),
      node({ role: 'AXButton', title: 'Half', y: 380, h: 60 }), // clipped to the window
    ],
    { x: 0, y: 0, w: 500, h: 400 },
  )
  assert.deepEqual(out.map((e) => e.name), ['Pressable', 'Half'])
  assert.equal(out[1].box.h, 20) // clipped from 60 to 400-380
})

test('reading order: bands of 12 pt, then left to right; ids 0..n-1', opts, () => {
  const out = normalize([
    node({ role: 'AXButton', title: 'C', x: 300, y: 100 }),
    node({ role: 'AXButton', title: 'B', x: 200, y: 105 }),
    node({ role: 'AXButton', title: 'A', x: 100, y: 110 }),
    node({ role: 'AXButton', title: 'D', x: 50, y: 200 }),
  ])
  assert.deepEqual(out.map((e) => e.name), ['A', 'B', 'C', 'D'])
})

test('wrapper with the same name around a smaller element is dropped; cap is 80', opts, () => {
  const w = normalize([
    node({ role: 'AXRow', childText: 'Inbox', x: 0, y: 0, w: 300, h: 40 }),
    node({ role: 'AXButton', title: 'Inbox', x: 10, y: 5, w: 60, h: 20 }),
  ])
  assert.equal(w.length, 1)
  assert.equal(w[0].role, 'button')
  const many = normalize(Array.from({ length: 120 }, (_, i) => node({ role: 'AXButton', title: 'b' + i, y: i * 40 })))
  assert.equal(many.length, 80)
})

test('output matches the shared schema shape', opts, () => {
  const out = normalize([node({ role: 'AXButton', title: 'Ok', x: 1.234, y: 2.345 })])
  const e = out[0]
  assert.deepEqual(Object.keys(e).sort(), ['box', 'id', 'name', 'role'])
  assert.deepEqual(Object.keys(e.box).sort(), ['h', 'w', 'x', 'y'])
  assert.equal(e.box.x, 1.2)
  assert.equal(e.box.y, 2.3)
})
