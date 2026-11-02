import type { ReactNode } from 'react'
import { cn } from '@glance/ui/lib/utils'
import type { Hot } from './useGazeSelect'

/** A big glass key. The dwell shows as a white fill rising from the bottom (no color: opacity and light only). */
export function GazeKey({ id, hot, children, className, onPress, style }: { id: string; hot: Hot | null; children: ReactNode; className?: string; onPress?: () => void; style?: React.CSSProperties }) {
  const on = hot?.id === id
  const p = on ? hot!.p : 0
  return (
    <button
      data-gaze={id}
      onClick={onPress}
      style={{
        borderColor: on ? `rgba(255,255,255,${0.45 + 0.5 * p})` : undefined,
        boxShadow: on ? `0 0 ${12 + 34 * p}px rgba(255,255,255,${0.12 + 0.35 * p}), inset 0 1.5px 0 rgba(255,255,255,.7)` : undefined,
        ...style,
      }}
      className={cn('glass glass-dark flex cursor-pointer items-center justify-center overflow-hidden text-white transition-[border-color,box-shadow] duration-100', className)}
    >
      <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-white/30" style={{ height: `${p * 100}%` }} />
      <span className="pointer-events-none relative">{children}</span>
    </button>
  )
}
