import { useEffect, useState } from 'react'
import { engine } from './engine'
import type { EngineStatus } from '../../shared/ipc'

export function useEngineStatus(): EngineStatus {
  const [s, setS] = useState<EngineStatus>(engine.status)
  useEffect(() => engine.onStatus(setS), [])
  return s
}
