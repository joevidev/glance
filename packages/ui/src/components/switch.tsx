import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"
import { cn } from "../lib/utils"

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-white/25 bg-white/10 transition outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:bg-white",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-4 translate-x-1 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-6 data-[state=checked]:bg-black" />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
