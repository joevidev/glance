import * as React from "react"

/** The Glance mark: a glass lens (iris) with a specular highlight. The catchlight is the gaze point. */
export function Mark({ size = 32, className, ...props }: { size?: number } & React.ComponentProps<"svg">) {
  const id = React.useId().replace(/:/g, "")
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" className={className} aria-label="Glance" {...props}>
      <defs>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".34" />
          <stop offset=".55" stopColor="#fff" stopOpacity=".05" />
          <stop offset="1" stopColor="#fff" stopOpacity=".16" />
        </linearGradient>
        <linearGradient id={`${id}r`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".95" />
          <stop offset=".5" stopColor="#fff" stopOpacity=".12" />
          <stop offset="1" stopColor="#fff" stopOpacity=".6" />
        </linearGradient>
        <radialGradient id={`${id}p`} cx=".4" cy=".35" r=".8">
          <stop offset="0" stopColor="#2a2a2a" />
          <stop offset="1" stopColor="#000" />
        </radialGradient>
        <radialGradient id={`${id}s`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#fff" stopOpacity=".95" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="100" cy="100" r="94" fill={`url(#${id}b)`} stroke={`url(#${id}r)`} strokeWidth="3" />
      <circle cx="100" cy="100" r="62" fill="none" stroke="#fff" strokeOpacity=".38" strokeWidth="2" />
      <circle cx="100" cy="100" r="40" fill={`url(#${id}p)`} stroke="#fff" strokeOpacity=".9" strokeWidth="3" />
      <ellipse cx="72" cy="58" rx="30" ry="14" transform="rotate(-35 72 58)" fill={`url(#${id}s)`} />
      <circle cx="118" cy="118" r="7" fill="#fff" fillOpacity=".85" />
    </svg>
  )
}

export function Wordmark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 font-semibold tracking-[-0.05em] ${className ?? ""}`} style={{ fontSize: size * 0.8 }}>
      <Mark size={size} />
      Glance
    </span>
  )
}
