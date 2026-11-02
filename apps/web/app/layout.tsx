import type { Metadata, Viewport } from "next"
import "./globals.css"
import { Header, Footer } from "../components/chrome"

export const metadata: Metadata = {
  title: { default: "Glance: your assistant can see what you see", template: "%s | Glance" },
  description:
    "Your assistant can hear you. Now it can see what you see. Webcam gaze plus a spoken command, resolved to the element you mean by a model. Built at the Fireworks buildathon, 2026-11-02.",
}
export const viewport: Viewport = { themeColor: "#000000", colorScheme: "dark" }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="relative">
        <div className="pointer-events-none fixed inset-0 -z-10 glass-ground" aria-hidden />
        <Header />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  )
}
