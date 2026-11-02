import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import { cn } from "../lib/utils"

const buttonVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-all outline-none select-none cursor-pointer disabled:pointer-events-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 active:scale-[0.97]",
  {
    variants: {
      variant: {
        // solid white pill: the primary action
        default: "bg-primary text-primary-foreground hover:bg-white/85 shadow-[0_10px_30px_-10px_rgba(255,255,255,0.5)]",
        // glass pill
        glass:
          "text-white border border-white/25 bg-[linear-gradient(135deg,rgba(255,255,255,.2),rgba(255,255,255,.05))] shadow-[inset_0_1px_0_rgba(255,255,255,.5)] backdrop-blur-xl hover:bg-white/15",
        outline: "border border-white/25 text-white hover:bg-white/10",
        ghost: "text-white/70 hover:bg-white/10 hover:text-white",
        link: "text-white underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-5",
        sm: "h-8 px-3.5 text-xs",
        lg: "h-12 px-7 text-base",
        icon: "size-10",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
)

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button"
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }
