import type { Metadata } from "next"
import { CaseExplorer, Playground } from "../../components/Try"
import { Section } from "../../components/bits"

export const metadata: Metadata = {
  title: "Try it",
  description: "Move a cursor with your eyes in the browser, calibrate it to your face, and explore real benchmark cases. Runs locally; nothing is uploaded.",
}

export default function TryPage() {
  return (
    <>
      <Section
        eyebrow="Try it"
        title={
          <>
            Your eyes are the cursor. <em>Right here.</em>
          </>
        }
      >
        <Playground />
        <div className="mt-8 grid gap-3 text-sm text-w60 sm:grid-cols-3">
          <p>
            <b className="font-semibold text-white">What &ldquo;fine-tune&rdquo; means here.</b> It adjusts <em>your personal gaze mapping</em>, a small
            regression fitted in your browser, with six more points. It does not train the language model. The LoRA we trained on Fireworks did not beat its base
            (see results).
          </p>
          <p>
            <b className="font-semibold text-white">Honest status.</b> The camera path reuses the desktop app&rsquo;s code and has been verified with synthetic
            frames and a fake camera only, not yet with a real face. Lighting, glasses and head movement matter. Wink thresholds are defaults.
          </p>
          <p>
            <b className="font-semibold text-white">Privacy.</b> Video, gaze and calibration never leave this tab. The face model (about 4 MB) and its WebAssembly
            runtime are downloaded from jsDelivr and Google Storage.
          </p>
        </div>
      </Section>

      <Section eyebrow="Explore the benchmark" title={<>Why a model, not just <em>the nearest element.</em></>}>
        <CaseExplorer />
      </Section>
    </>
  )
}
