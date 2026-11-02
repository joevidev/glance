import { deflateSync } from 'node:zlib'
import { Menu, Tray, nativeImage } from 'electron'

// 22x22 template icon drawn in code: a ring with a dot (the gaze point). Black on transparent; macOS tints it.
function crc32(buf: Buffer): number {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function ringPng(size: number): Buffer {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  const c = (size - 1) / 2
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c)
      const ring = Math.max(0, 1 - Math.abs(d - size * 0.38) / 1.3)
      const dot = Math.max(0, 1 - Math.max(0, d - size * 0.12) / 1.2)
      const a = Math.min(1, ring + dot)
      const o = y * (size * 4 + 1) + 1 + x * 4
      raw[o] = 0
      raw[o + 1] = 0
      raw[o + 2] = 0
      raw[o + 3] = Math.round(a * 255)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

export function createTray(h: {
  show: (w: 'main' | 'browse') => void
  togglePause: () => boolean
  isPaused: () => boolean
  quit: () => void
}): Tray {
  const img = nativeImage.createFromBuffer(ringPng(44), { scaleFactor: 2 })
  img.setTemplateImage(true)
  const tray = new Tray(img)
  tray.setToolTip('Glance')
  const build = () =>
    Menu.buildFromTemplate([
      { label: 'Glance', enabled: false },
      { type: 'separator' },
      { label: 'Open Glance', click: () => h.show('main') },
      { label: 'Open Browse', click: () => h.show('browse') },
      { type: 'separator' },
      {
        label: h.isPaused() ? 'Resume tracking' : 'Pause tracking',
        accelerator: 'Alt+Shift+P',
        click: () => {
          h.togglePause()
          tray.setContextMenu(build())
        },
      },
      { type: 'separator' },
      { label: 'Quit Glance', accelerator: 'Cmd+Q', click: () => h.quit() },
    ])
  tray.setContextMenu(build())
  tray.on('click', () => tray.setContextMenu(build()))
  return tray
}
