import type { ReactNode } from "react"

export function Section({ id, eyebrow, title, children, className = "" }: { id?: string; eyebrow: string; title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`mx-auto mt-20 max-w-6xl scroll-mt-24 px-4 sm:mt-28 sm:px-6 ${className}`}>
      <div className="eyebrow">{eyebrow}</div>
      {title && <h2 className="headline mt-3 max-w-4xl text-[clamp(1.9rem,4.6vw,3.6rem)] leading-[1.04]">{title}</h2>}
      <div className="mt-8">{children}</div>
    </section>
  )
}

export function Glass({ children, className = "", md = false }: { children: ReactNode; className?: string; md?: boolean }) {
  return <div className={`glass ${md ? "glass-md" : "glass-lg"} ${className}`}>{children}</div>
}

export function Stat({ k, v, d }: { k: string; v: string; d: ReactNode }) {
  return (
    <Glass md className="p-6">
      <div className="eyebrow">{k}</div>
      <div className="mt-4 text-[clamp(1.5rem,2vw,1.75rem)] sm:text-[clamp(1.5rem,2vw,1.75rem)] font-semibold leading-[1.05] tracking-[-0.04em]">{v}</div>
      <div className="mt-3 text-sm leading-snug text-w60">{d}</div>
    </Glass>
  )
}
