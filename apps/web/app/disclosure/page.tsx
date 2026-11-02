import type { Metadata } from "next"
import { Glass, Section } from "../../components/bits"
import { REPO, REPO_URL } from "../../lib/site"

export const metadata: Metadata = { title: "Disclosure", description: "What was built on 2026-11-02, how Claude Code was used, and third-party credits." }

const built = [
  "The Glance desktop app (Electron, React, Tailwind v4, shadcn/ui): onboarding, 9-point calibration, gesture training, the glass overlay, the debug panel, a radial menu, push-to-talk voice commands.",
  "Gaze and gestures: iris and blendshape tracking, a ridge calibration fit, smoothing, wink / nod / mouth gestures.",
  "A native mouse helper in Rust, driven as a child process by the app.",
  "The benchmark: a Playwright crawl of 36 public sites, a templated dataset split by site (2,520 train cases, 360 test cases locked by SHA-256), nine scored systems, McNemar and site-cluster bootstrap statistics.",
  "One LoRA fine-tune on Fireworks serverless training (rank 16, 1 epoch, 2,520 cases). It did not beat its base model.",
  "A shared intent prompt and element extractor, pinned by a golden fixture that Python and TypeScript both reproduce byte for byte.",
  "This website, the deck and the demo script.",
]

const credits: [string, string][] = [
  ["MediaPipe Face Landmarker", "Iris, blendshapes and head pose, run locally on the laptop."],
  ["Electron", "The desktop shell."],
  ["React", "UI for the desktop app and this site."],
  ["Next.js", "This website (static export)."],
  ["Tailwind CSS and shadcn/ui", "Styling and component primitives, with a shared liquid-glass theme."],
  ["Playwright", "Crawling the public sites for the dataset and the element extractor tests."],
  ["Fireworks SDK / API", "Open models glm-5p3 and glm-5p3-flash, and serverless LoRA training."],
  ["OpenAI SDK / API", "The frontier baseline (gpt-6-astra), speech to text, and the model call in the demo while the Fireworks account is suspended."],
  ["Organizers' sample submission", "The McNemar test plus cluster-bootstrap approach to comparing systems; we reimplemented it with SciPy."],
  ["Geist, Lucide, Turborepo, pnpm, uv, SciPy", "Typeface, icons, monorepo and Python tooling, statistics."],
]

export default function Disclosure() {
  return (
    <>
      <section className="mx-auto max-w-6xl px-4 pt-14 sm:px-6 sm:pt-20">
        <div className="eyebrow">Disclosure</div>
        <h1 className="headline mt-3 text-[clamp(2.2rem,5.6vw,4.4rem)] leading-[1.03]">What we built, <em>and what we used.</em></h1>
        <p className="mt-5 max-w-2xl text-lg font-light leading-relaxed text-w80">
          Everything here was built during the event on 2026-11-02. Source: <a href={REPO_URL} className="underline decoration-white/30 underline-offset-4">{REPO}</a>.
        </p>
      </section>

      <Section eyebrow="Built today" title={<>All of it, <em>in one day.</em></>}>
        <Glass className="p-6 sm:p-10">
          <ul className="relative z-10">
            {built.map((b, i) => (
              <li key={i} className={`py-4 text-lg leading-snug text-w80 ${i ? "rowline" : ""}`}>{b}</li>
            ))}
          </ul>
        </Glass>
      </Section>

      <Section eyebrow="AI assistance" title={<>Claude Code <em>helped write it.</em></>}>
        <Glass md className="p-6 sm:p-10">
          <p className="relative z-10 max-w-3xl text-lg leading-relaxed text-w80">
            Claude Code (Anthropic) was used throughout: to write and review code, to run parallel sub-agents on separate parts of the monorepo, and to draft the deck, the descriptions and this site. The people on the team set the plan, ran the experiments and read the numbers. The benchmark results come from saved rows and a script, not from a model’s say-so.
          </p>
        </Glass>
      </Section>

      <Section eyebrow="Third-party credits" title={<>Standing on <em>other people’s work.</em></>}>
        <Glass md className="p-2 sm:p-4">
          <ul className="relative z-10">
            {credits.map(([n, d], i) => (
              <li key={n} className={`grid gap-1 px-4 py-4 sm:grid-cols-[18rem_1fr] sm:gap-6 ${i ? "rowline" : ""}`}>
                <span className="font-medium">{n}</span>
                <span className="text-w60">{d}</span>
              </li>
            ))}
          </ul>
        </Glass>
      </Section>
    </>
  )
}
