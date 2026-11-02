import { contextBridge, ipcRenderer } from 'electron'
import type { GlanceAPI } from '../shared/ipc'

const api: GlanceAPI = {
  invoke: (channel, arg) => ipcRenderer.invoke(channel, arg),
  send: (channel, msg) => ipcRenderer.send(channel, msg),
  on: (channel, cb) => {
    const h = (_e: unknown, msg: unknown) => cb(msg as never)
    ipcRenderer.on(channel, h)
    return () => ipcRenderer.removeListener(channel, h)
  },
}

contextBridge.exposeInMainWorld('glance', api)
