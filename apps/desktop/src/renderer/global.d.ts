/// <reference types="vite/client" />
import type { GlanceAPI } from '../shared/ipc'
declare global {
  interface Window {
    glance: GlanceAPI
  }
}
export {}
