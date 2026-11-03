import Link from "next/link"
import { Mark } from "@glance/ui/components/mark"
import { REPO, REPO_URL } from "../lib/site"

const nav = [
  { href: "/", label: "Home" },
  { href: "/try/", label: "Try it" },
  { href: "/results/", label: "Results" },
  { href: "/disclosure/", label: "Disclosure" },
]

export function Header() {
  return (
    <header className="sticky top-0 z-40 px-4 pt-3 sm:px-6">
      <div className="glass glass-pill mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
        <Link href="/" className="relative z-10 flex items-center gap-2.5 font-semibold tracking-[-0.05em]">
          <Mark size={28} />
          <span className="text-lg">Glance</span>
        </Link>
        <nav className="relative z-10 flex items-center gap-1 text-sm sm:gap-2">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className={`rounded-full px-2.5 py-1.5 text-w80 transition hover:bg-white/10 hover:text-white sm:px-3 ${n.href === "/" ? "hidden sm:block" : ""}`}>
              {n.label}
            </Link>
          ))}
          <a href={REPO_URL} className="mono hidden rounded-full px-3 py-1.5 text-xs tracking-wider text-w60 hover:text-white md:block">
            GITHUB
          </a>
        </nav>
      </div>
    </header>
  )
}

export function Footer() {
  return (
    <footer className="mx-auto mt-24 max-w-6xl px-4 pb-12 sm:px-6">
      <div className="rowline flex flex-col gap-3 pt-6 text-sm text-w60 sm:flex-row sm:items-center sm:justify-between">
        <span className="flex items-center gap-2.5 text-w80">
          <Mark size={22} />
          <span className="mono text-xs tracking-[0.14em]">GLANCE</span>
        </span>
        <span>Built on 2026-11-02 at the Fireworks: Deploy Buildathon. Joel Timana, Diana Munoz.</span>
        <a href={REPO_URL} className="mono text-xs tracking-wider text-w80 underline decoration-white/30 underline-offset-4">
          {REPO}
        </a>
      </div>
    </footer>
  )
}
