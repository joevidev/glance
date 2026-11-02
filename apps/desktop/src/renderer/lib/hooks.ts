import { useEffect, useState } from 'react'
import type { AppInfo, EventMap, InputStatus, Settings } from '../../shared/ipc'

export function useEvent<K extends keyof EventMap>(ch: K, cb: (m: EventMap[K]) => void): void {
  useEffect(() => window.glance.on(ch, cb))
}

export function useSettings(): [Settings | null, (p: Partial<Settings>) => void] {
  const [s, setS] = useState<Settings | null>(null)
  useEffect(() => {
    void window.glance.invoke('settings:get').then(setS)
    return window.glance.on('settings:changed', setS)
  }, [])
  return [s, (p) => void window.glance.invoke('settings:set', p).then(setS)]
}

export function useAppInfo(): AppInfo | null {
  const [i, setI] = useState<AppInfo | null>(null)
  useEffect(() => void window.glance.invoke('app:info').then(setI), [])
  return i
}

export function useInputStatus(): InputStatus | null {
  const [s, setS] = useState<InputStatus | null>(null)
  useEffect(() => {
    void window.glance.invoke('input:status').then(setS)
    const off = window.glance.on('input:status', setS)
    const t = setInterval(() => void window.glance.invoke('input:status').then(setS), 4000)
    return () => {
      off()
      clearInterval(t)
    }
  }, [])
  return s
}
