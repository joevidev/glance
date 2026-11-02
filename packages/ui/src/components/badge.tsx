import * as React from "react"
import { cn } from "../lib/utils"

/** Mono pill for labels and numbers (brand: Geist Mono, uppercase, wide tracking). */
export function Badge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/8 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,.4)]",
        className,
      )}
      {...props}
    />
  )
}
